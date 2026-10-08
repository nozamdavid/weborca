#include "TextOps.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Emboss.hpp"
#include "libslic3r/EmbossShape.hpp"
#include "libslic3r/TextConfiguration.hpp"
#include "libslic3r/Utils.hpp"
#include "PlateOps.hpp"

#include <boost/filesystem.hpp>
#include <boost/nowide/convert.hpp>
#include <cmath>
#include <string>
#include <vector>
#include <memory>
#include <algorithm>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

constexpr float SAFE_SURFACE_OFFSET = 0.015f; // [in mm]
constexpr double SHAPE_SCALE = 0.001;
constexpr unsigned MAX_HEAL_ITERATION_OF_TEXT = 10;

Slic3r::ModelVolumeType parse_volume_type(const std::string& str) {
    if (str == "part" || str == "model_part")
        return Slic3r::ModelVolumeType::MODEL_PART;
    if (str == "negative" || str == "negative_volume")
        return Slic3r::ModelVolumeType::NEGATIVE_VOLUME;
    if (str == "modifier" || str == "parameter_modifier")
        return Slic3r::ModelVolumeType::PARAMETER_MODIFIER;
    if (str == "support_blocker")
        return Slic3r::ModelVolumeType::SUPPORT_BLOCKER;
    if (str == "support_enforcer")
        return Slic3r::ModelVolumeType::SUPPORT_ENFORCER;
    return Slic3r::ModelVolumeType::MODEL_PART;
}

std::string volume_type_to_string(Slic3r::ModelVolumeType type) {
    switch (type) {
    case Slic3r::ModelVolumeType::MODEL_PART: return "part";
    case Slic3r::ModelVolumeType::NEGATIVE_VOLUME: return "negative";
    case Slic3r::ModelVolumeType::PARAMETER_MODIFIER: return "modifier";
    case Slic3r::ModelVolumeType::SUPPORT_BLOCKER: return "support_blocker";
    case Slic3r::ModelVolumeType::SUPPORT_ENFORCER: return "support_enforcer";
    default: return "part";
    }
}

Slic3r::ModelObject* find_object(Slic3r::Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

const Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t object_id) {
    for (const auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

Slic3r::ModelVolume* find_volume(Slic3r::ModelObject* obj, size_t volume_id) {
    if (!obj) return nullptr;
    for (auto* vol : obj->volumes) {
        if (vol && vol->id().id == volume_id)
            return vol;
    }
    return nullptr;
}

const Slic3r::ModelVolume* find_volume(const Slic3r::ModelObject* obj, size_t volume_id) {
    if (!obj) return nullptr;
    for (const auto* vol : obj->volumes) {
        if (vol && vol->id().id == volume_id)
            return vol;
    }
    return nullptr;
}

std::vector<unsigned char> base64_decode(const std::string& input) {
    const std::string b64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<unsigned char> out;
    std::vector<int> T(256, -1);
    for (int i = 0; i < 64; ++i) T[static_cast<unsigned char>(b64_chars[i])] = i;

    int val = 0, valb = -8;
    for (unsigned char c : input) {
        if (T[c] == -1) continue;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(static_cast<unsigned char>((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

std::unique_ptr<Slic3r::Emboss::FontFile> load_font_file(const std::string& font_data_or_path, std::string& loaded_path) {
    // 1. Try direct path if non-empty
    if (!font_data_or_path.empty()) {
        if (boost::filesystem::exists(font_data_or_path)) {
            loaded_path = font_data_or_path;
            auto ff = Slic3r::Emboss::create_font_file(font_data_or_path.c_str());
            if (ff) return ff;
        }

        // Try base64 decoding if string is longer and doesn't contain path separators
        if (font_data_or_path.find('/') == std::string::npos && font_data_or_path.find('\\') == std::string::npos && font_data_or_path.size() > 64) {
            std::vector<unsigned char> bytes = base64_decode(font_data_or_path);
            if (!bytes.empty()) {
                auto data_ptr = std::make_unique<std::vector<unsigned char>>(std::move(bytes));
                auto ff = Slic3r::Emboss::create_font_file(std::move(data_ptr));
                if (ff) {
                    loaded_path = "<embedded_font>";
                    return ff;
                }
            }
        }
    }

    // 2. Fallbacks for standard bundled and system fonts
    const std::vector<std::string> fallback_candidates = {
        "/fonts/DejaVuSans.ttf",
        "/fonts/LiberationSans-Regular.ttf",
        "/fonts/DejaVuSerif.ttf",
        "/fonts/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
    };

    for (const auto& path : fallback_candidates) {
        if (boost::filesystem::exists(path)) {
            loaded_path = path;
            auto ff = Slic3r::Emboss::create_font_file(path.c_str());
            if (ff) return ff;
        }
    }

    throw Slic3r::RuntimeError("Could not load TrueType font from '" + font_data_or_path + "' or default font paths.");
}

Slic3r::FontProp::HorizontalAlign parse_h_align(const std::string& align) {
    if (align == "left") return Slic3r::FontProp::HorizontalAlign::left;
    if (align == "right") return Slic3r::FontProp::HorizontalAlign::right;
    return Slic3r::FontProp::HorizontalAlign::center;
}

Slic3r::FontProp::VerticalAlign parse_v_align(const std::string& align) {
    if (align == "top") return Slic3r::FontProp::VerticalAlign::top;
    if (align == "bottom") return Slic3r::FontProp::VerticalAlign::bottom;
    return Slic3r::FontProp::VerticalAlign::center;
}

std::string align_h_to_string(Slic3r::FontProp::HorizontalAlign align) {
    switch (align) {
    case Slic3r::FontProp::HorizontalAlign::left: return "left";
    case Slic3r::FontProp::HorizontalAlign::right: return "right";
    default: return "center";
    }
}

std::string align_v_to_string(Slic3r::FontProp::VerticalAlign align) {
    switch (align) {
    case Slic3r::FontProp::VerticalAlign::top: return "top";
    case Slic3r::FontProp::VerticalAlign::bottom: return "bottom";
    default: return "center";
    }
}

struct GeneratedTextMesh {
    Slic3r::TriangleMesh mesh;
    Slic3r::TextConfiguration text_config;
    Slic3r::EmbossShape emboss_shape;
};

GeneratedTextMesh generate_text_geometry(
    const std::string& text,
    const std::string& font_data_or_path,
    const std::string& font_name,
    double size,
    double depth,
    const std::optional<int>& char_gap,
    const std::optional<int>& line_gap,
    const std::optional<float>& boldness,
    const std::optional<float>& skew,
    Slic3r::FontProp::HorizontalAlign h_align,
    Slic3r::FontProp::VerticalAlign v_align,
    bool use_surface,
    bool is_new_object,
    Slic3r::ModelVolumeType volume_type
) {
    std::string actual_font_path;
    std::unique_ptr<Slic3r::Emboss::FontFile> font_file = load_font_file(font_data_or_path, actual_font_path);

    Slic3r::FontProp fp(static_cast<float>(size));
    if (char_gap.has_value()) fp.char_gap = *char_gap;
    if (line_gap.has_value()) fp.line_gap = *line_gap;
    if (boldness.has_value()) fp.boldness = *boldness;
    if (skew.has_value()) fp.skew = *skew;
    fp.align = std::make_pair(h_align, v_align);

    Slic3r::Emboss::FontFileWithCache fwc(std::move(font_file));

    std::wstring text_w = boost::nowide::widen(text);
    Slic3r::ExPolygonsWithIds vshapes = Slic3r::Emboss::text2vshapes(fwc, text_w, fp);
    if (vshapes.empty()) {
        throw Slic3r::RuntimeError("Failed to rasterize text outlines for '" + text + "'");
    }

    double scale = Slic3r::Emboss::get_text_shape_scale(fp, *fwc.font_file);
    if (scale <= 0.0) {
        scale = SCALING_FACTOR;
    }

    Slic3r::EmbossShape es;
    es.shapes_with_ids = std::move(vshapes);
    es.scale = scale;
    es.projection.depth = depth;
    es.projection.use_surface = use_surface;

    float delta = static_cast<float>(1.0 / SHAPE_SCALE);
    Slic3r::ExPolygons shapes = Slic3r::union_with_delta(es, delta, MAX_HEAL_ITERATION_OF_TEXT);
    if (shapes.empty()) {
        throw Slic3r::RuntimeError("Empty polygon outline generated for text '" + text + "'");
    }

    double depth_in_shape = depth / scale;
    auto projectZ = std::make_unique<Slic3r::Emboss::ProjectZ>(depth_in_shape);

    float offset = 0.0f;
    if (!is_new_object) {
        bool is_outside = (volume_type != Slic3r::ModelVolumeType::NEGATIVE_VOLUME);
        offset = is_outside ? -SAFE_SURFACE_OFFSET : (SAFE_SURFACE_OFFSET - static_cast<float>(depth));
    }

    Slic3r::Transform3d tr = Eigen::Translation<double, 3>(0.0, 0.0, static_cast<double>(offset)) * Eigen::Scaling(scale);
    Slic3r::Emboss::ProjectTransform project(std::move(projectZ), tr);
    indexed_triangle_set its = Slic3r::Emboss::polygons2model(shapes, project);
    Slic3r::TriangleMesh mesh(std::move(its));

    Slic3r::TextConfiguration tc;
    tc.text = text;
    tc.style.name = font_name.empty() ? "Default" : font_name;
    tc.style.path = actual_font_path;
    tc.style.type = Slic3r::EmbossStyle::Type::file_path;
    tc.style.prop = fp;

    return GeneratedTextMesh{ std::move(mesh), std::move(tc), std::move(es) };
}

} // namespace

json addText(Slic3r::Model& model, Slic3r::PlateDataPtrs& plates, const json& args) {
    if (!args.contains("text") || !args["text"].is_string()) {
        throw Slic3r::RuntimeError("addText requires 'text' string argument");
    }
    std::string text = args["text"].get<std::string>();

    std::string volume_type_str = "new_object";
    if (args.contains("volumeType") && args["volumeType"].is_string()) {
        volume_type_str = args["volumeType"].get<std::string>();
    } else if (args.contains("type") && args["type"].is_string()) {
        volume_type_str = args["type"].get<std::string>();
    }

    bool is_new_object = (volume_type_str == "new_object" || volume_type_str == "object");
    Slic3r::ModelVolumeType mv_type = is_new_object ? Slic3r::ModelVolumeType::MODEL_PART : parse_volume_type(volume_type_str);

    size_t object_id = 0;
    Slic3r::ModelObject* target_obj = nullptr;
    if (!is_new_object) {
        if (args.contains("objectId")) {
            object_id = args["objectId"].get<size_t>();
        } else if (args.contains("id")) {
            object_id = args["id"].get<size_t>();
        } else {
            throw Slic3r::RuntimeError("addText requires objectId when volumeType is not new_object");
        }
        target_obj = find_object(model, object_id);
        if (!target_obj) {
            throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
        }
    }

    std::string font_data_or_path = "";
    if (args.contains("fontData") && args["fontData"].is_string()) {
        font_data_or_path = args["fontData"].get<std::string>();
    } else if (args.contains("fontPath") && args["fontPath"].is_string()) {
        font_data_or_path = args["fontPath"].get<std::string>();
    } else if (args.contains("font") && args["font"].is_string()) {
        font_data_or_path = args["font"].get<std::string>();
    }

    std::string font_name = args.value("fontName", "DejaVu Sans");
    double size = args.value("size", 10.0);
    double depth = args.value("depth", 1.0);

    std::optional<int> char_gap;
    if (args.contains("charGap")) char_gap = args["charGap"].get<int>();
    else if (args.contains("char_gap")) char_gap = args["char_gap"].get<int>();

    std::optional<int> line_gap;
    if (args.contains("lineGap")) line_gap = args["lineGap"].get<int>();
    else if (args.contains("line_gap")) line_gap = args["line_gap"].get<int>();

    std::optional<float> boldness;
    if (args.contains("boldness")) boldness = args["boldness"].get<float>();

    std::optional<float> skew;
    if (args.contains("skew")) skew = args["skew"].get<float>();

    Slic3r::FontProp::HorizontalAlign h_align = Slic3r::FontProp::HorizontalAlign::center;
    Slic3r::FontProp::VerticalAlign v_align = Slic3r::FontProp::VerticalAlign::center;
    if (args.contains("align")) {
        const auto& al = args["align"];
        if (al.is_string()) {
            std::string al_str = al.get<std::string>();
            h_align = parse_h_align(al_str);
            v_align = parse_v_align(al_str);
        } else if (al.is_object()) {
            if (al.contains("horizontal")) h_align = parse_h_align(al["horizontal"].get<std::string>());
            if (al.contains("vertical")) v_align = parse_v_align(al["vertical"].get<std::string>());
        }
    }

    bool use_surface = false;
    if (args.contains("useSurface")) use_surface = args["useSurface"].get<bool>();
    else if (args.contains("use_surface")) use_surface = args["use_surface"].get<bool>();

    std::string custom_name = args.value("name", text);

    GeneratedTextMesh generated = generate_text_geometry(
        text, font_data_or_path, font_name, size, depth,
        char_gap, line_gap, boldness, skew, h_align, v_align,
        use_surface, is_new_object, mv_type
    );

    if (is_new_object) {
        Slic3r::ModelObject* new_obj = model.add_object();
        new_obj->name = custom_name;
        new_obj->add_instance();
        new_obj->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));

        Slic3r::ModelVolume* new_vol = new_obj->add_volume(std::move(generated.mesh), Slic3r::ModelVolumeType::MODEL_PART);
        new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));
        new_vol->name = custom_name;
        new_vol->source.is_from_builtin_objects = true;
        new_vol->text_configuration = std::move(generated.text_config);
        new_vol->emboss_shape = std::move(generated.emboss_shape);

        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
            new_obj->instances.front()->set_offset(pos);
        } else {
            new_obj->instances.front()->set_offset(Slic3r::Vec3d(0.0, 0.0, 0.0));
            new_obj->ensure_on_bed();
        }

        if (!plates.empty() && plates[0]) {
            plates[0]->objects_and_instances.emplace_back(static_cast<int>(model.objects.size() - 1), 0);
        }

        const auto& bb = new_vol->mesh().bounding_box();
        return json{
            {"objectId", new_obj->id().id},
            {"volumeId", new_vol->id().id},
            {"name", new_vol->name},
            {"triangleCount", new_vol->mesh().its.indices.size()},
            {"boundingBox", {bb.min.x(), bb.min.y(), bb.min.z(), bb.max.x(), bb.max.y(), bb.max.z()}}
        };
    } else {
        Slic3r::Vec3d pos;
        Slic3r::Vec3d norm(0.0, 0.0, 1.0);

        if (args.contains("normal") && args["normal"].is_array() && args["normal"].size() >= 3) {
            norm = Slic3r::Vec3d(args["normal"][0].get<double>(), args["normal"][1].get<double>(), args["normal"][2].get<double>());
            if (norm.norm() > 1e-6) norm.normalize();
            else norm = Slic3r::Vec3d(0.0, 0.0, 1.0);
        }

        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            pos = Slic3r::Vec3d(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
        } else {
            // Default placement on the top surface of the object instance
            Slic3r::BoundingBoxf3 inst_bb = target_obj->instance_bounding_box(0);
            pos = Slic3r::Vec3d(inst_bb.center().x(), inst_bb.center().y(), inst_bb.max.z());
        }

        double rotation = args.value("rotation", 0.0);
        // Convert to radians if passed in degrees
        double rot_rad = (std::abs(rotation) > 2.0 * M_PI) ? (rotation * M_PI / 180.0) : rotation;

        Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
        if (std::abs(rot_rad) > 1e-6) {
            surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
        }

        Slic3r::Transform3d vol_tr = target_obj->instances.front()->get_matrix().inverse() * surface_trmat;

        Slic3r::ModelVolume* new_vol = target_obj->add_volume(std::move(generated.mesh), mv_type);
        new_vol->set_transformation(vol_tr);
        new_vol->name = custom_name;
        new_vol->source.is_from_builtin_objects = true;
        new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(0));
        new_vol->text_configuration = std::move(generated.text_config);
        new_vol->emboss_shape = std::move(generated.emboss_shape);

        const auto& bb = new_vol->mesh().bounding_box();
        return json{
            {"objectId", target_obj->id().id},
            {"volumeId", new_vol->id().id},
            {"name", new_vol->name},
            {"triangleCount", new_vol->mesh().its.indices.size()},
            {"boundingBox", {bb.min.x(), bb.min.y(), bb.min.z(), bb.max.x(), bb.max.y(), bb.max.z()}}
        };
    }
}

json updateText(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    const auto* existing_tc = vol->text_configuration ? &(*vol->text_configuration) : nullptr;
    const auto* existing_es = vol->emboss_shape ? &(*vol->emboss_shape) : nullptr;

    std::string text = args.value("text", existing_tc ? existing_tc->text : "Text");
    std::string font_name = args.value("fontName", existing_tc ? existing_tc->style.name : "DejaVu Sans");

    std::string font_data_or_path = "";
    if (args.contains("fontData") && args["fontData"].is_string()) {
        font_data_or_path = args["fontData"].get<std::string>();
    } else if (args.contains("fontPath") && args["fontPath"].is_string()) {
        font_data_or_path = args["fontPath"].get<std::string>();
    } else if (args.contains("font") && args["font"].is_string()) {
        font_data_or_path = args["font"].get<std::string>();
    } else if (existing_tc) {
        font_data_or_path = existing_tc->style.path;
    }

    double size = args.value("size", existing_tc ? static_cast<double>(existing_tc->style.prop.size_in_mm) : 10.0);
    double depth = args.value("depth", existing_es ? existing_es->projection.depth : 1.0);

    std::optional<int> char_gap = existing_tc ? existing_tc->style.prop.char_gap : std::nullopt;
    if (args.contains("charGap")) char_gap = args["charGap"].get<int>();
    else if (args.contains("char_gap")) char_gap = args["char_gap"].get<int>();

    std::optional<int> line_gap = existing_tc ? existing_tc->style.prop.line_gap : std::nullopt;
    if (args.contains("lineGap")) line_gap = args["lineGap"].get<int>();
    else if (args.contains("line_gap")) line_gap = args["line_gap"].get<int>();

    std::optional<float> boldness = existing_tc ? existing_tc->style.prop.boldness : std::nullopt;
    if (args.contains("boldness")) boldness = args["boldness"].get<float>();

    std::optional<float> skew = existing_tc ? existing_tc->style.prop.skew : std::nullopt;
    if (args.contains("skew")) skew = args["skew"].get<float>();

    Slic3r::FontProp::HorizontalAlign h_align = existing_tc ? existing_tc->style.prop.align.first : Slic3r::FontProp::HorizontalAlign::center;
    Slic3r::FontProp::VerticalAlign v_align = existing_tc ? existing_tc->style.prop.align.second : Slic3r::FontProp::VerticalAlign::center;
    if (args.contains("align")) {
        const auto& al = args["align"];
        if (al.is_string()) {
            std::string al_str = al.get<std::string>();
            h_align = parse_h_align(al_str);
            v_align = parse_v_align(al_str);
        } else if (al.is_object()) {
            if (al.contains("horizontal")) h_align = parse_h_align(al["horizontal"].get<std::string>());
            if (al.contains("vertical")) v_align = parse_v_align(al["vertical"].get<std::string>());
        }
    }

    bool use_surface = existing_es ? existing_es->projection.use_surface : false;
    if (args.contains("useSurface")) use_surface = args["useSurface"].get<bool>();
    else if (args.contains("use_surface")) use_surface = args["use_surface"].get<bool>();

    bool is_new_object = (obj->volumes.size() == 1 && vol->type() == Slic3r::ModelVolumeType::MODEL_PART);

    GeneratedTextMesh generated = generate_text_geometry(
        text, font_data_or_path, font_name, size, depth,
        char_gap, line_gap, boldness, skew, h_align, v_align,
        use_surface, is_new_object, vol->type()
    );

    vol->set_mesh(std::move(generated.mesh));
    vol->calculate_convex_hull();
    vol->text_configuration = std::move(generated.text_config);
    vol->emboss_shape = std::move(generated.emboss_shape);

    if (args.contains("name") && args["name"].is_string()) {
        vol->name = args["name"].get<std::string>();
    } else {
        vol->name = text;
    }

    if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
        Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
        Slic3r::Vec3d norm(0.0, 0.0, 1.0);
        if (args.contains("normal") && args["normal"].is_array() && args["normal"].size() >= 3) {
            norm = Slic3r::Vec3d(args["normal"][0].get<double>(), args["normal"][1].get<double>(), args["normal"][2].get<double>());
            if (norm.norm() > 1e-6) norm.normalize();
        }
        double rotation = args.value("rotation", 0.0);
        double rot_rad = (std::abs(rotation) > 2.0 * M_PI) ? (rotation * M_PI / 180.0) : rotation;

        Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
        if (std::abs(rot_rad) > 1e-6) {
            surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
        }
        Slic3r::Transform3d vol_tr = obj->instances.front()->get_matrix().inverse() * surface_trmat;
        vol->set_transformation(vol_tr);
    }

    const auto& bb = vol->mesh().bounding_box();
    return json{
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"name", vol->name},
        {"triangleCount", vol->mesh().its.indices.size()},
        {"boundingBox", {bb.min.x(), bb.min.y(), bb.min.z(), bb.max.x(), bb.max.y(), bb.max.z()}}
    };
}

json getText(const Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();

    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    const Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    if (!vol->text_configuration.has_value()) {
        throw Slic3r::RuntimeError("Volume is not a text volume: " + std::to_string(volume_id));
    }

    const auto& tc = *vol->text_configuration;
    const auto* es = vol->emboss_shape ? &(*vol->emboss_shape) : nullptr;

    json res = {
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"name", vol->name},
        {"text", tc.text},
        {"fontName", tc.style.name},
        {"fontPath", tc.style.path},
        {"size", tc.style.prop.size_in_mm},
        {"depth", es ? es->projection.depth : 1.0},
        {"useSurface", es ? es->projection.use_surface : false},
        {"charGap", tc.style.prop.char_gap.value_or(0)},
        {"lineGap", tc.style.prop.line_gap.value_or(0)},
        {"boldness", tc.style.prop.boldness.value_or(0.0f)},
        {"skew", tc.style.prop.skew.value_or(0.0f)},
        {"align", {
            {"horizontal", align_h_to_string(tc.style.prop.align.first)},
            {"vertical", align_v_to_string(tc.style.prop.align.second)}
        }}
    };

    return res;
}

} // namespace OrcaWasm
