#include "TextOps.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/CutSurface.hpp"
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
#include <limits>
#include <optional>

using json = nlohmann::json;


// Port of desktop's EmbossJob cut-surface path (src/slic3r/GUI/Jobs/EmbossJob.cpp), which lives in the GUI library.
namespace OrcaWasm::surface {
using namespace Slic3r;

struct ModelSource {
    std::shared_ptr<const TriangleMesh> mesh;
    Transform3d tr;
};
using ModelSources = std::vector<ModelSource>;

Emboss::OrthoProject create_projection_for_cut(Transform3d tr, double shape_scale, const std::pair<float, float> &z_range) {
    double safe_extension = 1.0;
    double min_z = z_range.first - safe_extension;
    double max_z = z_range.second + safe_extension;
    double projection_size = max_z - min_z;
    Matrix3d transformation_for_vector = tr.linear();
    Vec3d untransformed_direction(0., 0., projection_size);
    Vec3d project_direction = transformation_for_vector * untransformed_direction;
    tr.translate(Vec3d(0., 0., min_z));
    tr.scale(shape_scale);
    return Emboss::OrthoProject(tr, project_direction);
}

Emboss::OrthoProject3d create_emboss_projection(bool is_outside, float emboss, Transform3d tr, SurfaceCut &cut) {
    float SAFE_SURFACE_OFFSET = 0.015f;
    float front_move = is_outside ? emboss : SAFE_SURFACE_OFFSET;
    float back_move = -(is_outside ? SAFE_SURFACE_OFFSET : emboss);
    its_transform(cut, tr.pretranslate(Vec3d(0., 0., front_move)));
    Vec3d from_front_to_back(0., 0., back_move - front_move);
    return Emboss::OrthoProject3d(from_front_to_back);
}

indexed_triangle_set cut_surface_to_its(const ExPolygons &shapes, const Transform3d& tr, const ModelSources &sources, double shape_scale, bool is_outside, double depth) {
    if (sources.empty()) return {};
    BoundingBox bb = get_extents(shapes);
    const ModelSource *biggest = &sources.front();
    size_t biggest_count = 0;
    std::vector<size_t> s_to_itss(sources.size(), std::numeric_limits<size_t>::max());
    std::vector<indexed_triangle_set> itss;
    itss.reserve(sources.size());
    for (const ModelSource &s : sources) {
        Transform3d mesh_tr_inv = s.tr.inverse();
        Transform3d cut_projection_tr = mesh_tr_inv * tr;
        std::pair<float, float> z_range{0., 1.};
        Emboss::OrthoProject cut_projection = create_projection_for_cut(cut_projection_tr, shape_scale, z_range);
        indexed_triangle_set its = its_cut_AoI(s.mesh->its, bb, cut_projection);
        if (its.indices.empty()) continue;
        if (biggest_count < its.vertices.size()) {
            biggest_count = its.vertices.size();
            biggest = &s;
        }
        size_t source_index = &s - &sources.front();
        size_t its_index = itss.size();
        s_to_itss[source_index] = its_index;
        itss.emplace_back(std::move(its));
    }
    if (itss.empty()) return {};
    Transform3d tr_inv = biggest->tr.inverse();
    Transform3d cut_projection_tr = tr_inv * tr;
    size_t itss_index = s_to_itss[biggest - &sources.front()];
    BoundingBoxf3 mesh_bb = bounding_box(itss[itss_index]);
    for (const ModelSource &s : sources) {
        itss_index = s_to_itss[&s - &sources.front()];
        if (itss_index == std::numeric_limits<size_t>::max()) continue;
        if (&s == biggest) continue;
        Transform3d tr2 = s.tr * tr_inv;
        bool fix_reflected = true;
        indexed_triangle_set &its = itss[itss_index];
        its_transform(its, tr2, fix_reflected);
        BoundingBoxf3 its_bb = bounding_box(its);
        mesh_bb.merge(its_bb);
    }
    Transform3d emboss_tr = cut_projection_tr.inverse();
    BoundingBoxf3 mesh_bb_tr = mesh_bb.transformed(emboss_tr);
    std::pair<float, float> z_range{mesh_bb_tr.min.z(), mesh_bb_tr.max.z()};
    Emboss::OrthoProject cut_projection = create_projection_for_cut(cut_projection_tr, shape_scale, z_range);
    double safe_extension = 1.0;
    float projection_ratio = (-z_range.first + safe_extension) / (z_range.second - z_range.first + 2 * safe_extension);
    ExPolygons shapes_data;
    const ExPolygons *shapes_ptr = &shapes;
    bool is_text_reflected = has_reflection(tr);
    if (is_text_reflected) {
        shapes_data = shapes;
        for (ExPolygon &shape : shapes_data) {
            shape.contour.reverse();
            for (Polygon &hole : shape.holes) hole.reverse();
        }
        shapes_ptr = &shapes_data;
    }
    SurfaceCut cut = cut_surface(*shapes_ptr, itss, cut_projection, projection_ratio);
    if (is_text_reflected) {
        for (SurfaceCut::Contour &c : cut.contours) std::reverse(c.begin(), c.end());
        for (Vec3i32 &t : cut.indices) std::swap(t[0], t[1]);
    }
    if (cut.empty()) return {};
    Emboss::OrthoProject3d projection = create_emboss_projection(is_outside, static_cast<float>(depth), emboss_tr, cut);
    return cut2model(cut, projection);
}

} // namespace OrcaWasm::surface

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
    for (int k = 0; k < 64; ++k) T[static_cast<unsigned char>(b64_chars[k])] = k;

    size_t start_pos = 0;
    size_t comma = input.find(',');
    if (comma != std::string::npos && input.find("base64") != std::string::npos && comma < 100) {
        start_pos = comma + 1;
    }

    uint32_t val = 0;
    int valb = -8;
    for (size_t k = start_pos; k < input.size(); ++k) {
        unsigned char c = static_cast<unsigned char>(input[k]);
        if (c == '=') break;
        if (T[c] == -1) continue;
        val = (val << 6) | static_cast<uint32_t>(T[c]);
        valb += 6;
        if (valb >= 0) {
            out.push_back(static_cast<unsigned char>((val >> valb) & 0xFF));
            valb -= 8;
        }
        if (valb == -8) {
            val = 0;
        }
    }
    return out;
}

std::unique_ptr<Slic3r::Emboss::FontFile> load_font_file(
    const std::string& font_data,
    const std::string& font_path,
    std::string& loaded_path
) {
    // 1. Explicit fontData (base64) provided:
    if (!font_data.empty()) {
        std::vector<unsigned char> bytes = base64_decode(font_data);
        if (bytes.empty()) {
            throw Slic3r::RuntimeError("Provided fontData failed to base64-decode or is empty");
        }
        auto data_ptr = std::make_unique<std::vector<unsigned char>>(std::move(bytes));
        auto ff = Slic3r::Emboss::create_font_file(std::move(data_ptr));
        if (!ff) {
            throw Slic3r::RuntimeError("Failed to parse TrueType/OpenType font from provided fontData");
        }
        loaded_path = "<embedded_font>";
        return ff;
    }

    // 2. Explicit fontPath provided:
    if (!font_path.empty()) {
        if (font_path.size() >= 4096) {
            throw Slic3r::RuntimeError("Font path exceeds maximum allowable length: " + font_path.substr(0, 64));
        }
        if (!boost::filesystem::exists(font_path)) {
            throw Slic3r::RuntimeError("Font file not found at path: " + font_path);
        }
        auto ff = Slic3r::Emboss::create_font_file(font_path.c_str());
        if (!ff) {
            throw Slic3r::RuntimeError("Failed to parse font file at path: " + font_path);
        }
        loaded_path = font_path;
        return ff;
    }

    // 3. Fallbacks for standard bundled and system fonts ONLY when no custom font was specified
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
            auto ff = Slic3r::Emboss::create_font_file(path.c_str());
            if (ff) {
                loaded_path = path;
                return ff;
            }
        }
    }

    throw Slic3r::RuntimeError("No font specified and could not load default font from fallback paths.");
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
    const std::string& font_data,
    const std::string& font_path,
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
    Slic3r::ModelVolumeType volume_type,
    const std::optional<OrcaWasm::surface::ModelSources>& sources = std::nullopt,
    const std::optional<Slic3r::Transform3d>& text_tr = std::nullopt
) {
    std::string actual_font_path;
    std::unique_ptr<Slic3r::Emboss::FontFile> font_file = load_font_file(font_data, font_path, actual_font_path);

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
    indexed_triangle_set its;
    if (use_surface && sources && !sources->empty()) {
        bool is_outside = (volume_type != Slic3r::ModelVolumeType::NEGATIVE_VOLUME);
        its = OrcaWasm::surface::cut_surface_to_its(shapes, text_tr ? *text_tr : tr, *sources, scale, is_outside, depth);
        if (its.indices.empty()) {
            its = Slic3r::Emboss::polygons2model(shapes, project);
        }
    } else {
        its = Slic3r::Emboss::polygons2model(shapes, project);
    }
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

    std::string font_data = "";
    if (args.contains("fontData") && args["fontData"].is_string()) {
        font_data = args["fontData"].get<std::string>();
    }

    std::string font_path = "";
    if (args.contains("fontPath") && args["fontPath"].is_string()) {
        font_path = args["fontPath"].get<std::string>();
    } else if (args.contains("font") && args["font"].is_string()) {
        const std::string& val = args["font"].get<std::string>();
        if (val.size() > 512) font_data = val;
        else font_path = val;
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

    std::optional<OrcaWasm::surface::ModelSources> sources;
    std::optional<::Slic3r::Transform3d> text_tr;
    if (!is_new_object && target_obj) {
        OrcaWasm::surface::ModelSources src;
        for (const Slic3r::ModelVolume *v : target_obj->volumes) {
            if (!v->is_model_part()) continue;
            const Slic3r::TriangleMesh &tm = v->mesh();
            if (tm.empty() || tm.its.empty()) continue;
            src.push_back({v->get_mesh_shared_ptr(), v->get_matrix()});
        }
        sources = std::move(src);

        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            ::Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
            ::Slic3r::Vec3d norm(0.0, 0.0, 1.0);
            if (args.contains("normal") && args["normal"].is_array() && args["normal"].size() >= 3) {
                norm = ::Slic3r::Vec3d(args["normal"][0].get<double>(), args["normal"][1].get<double>(), args["normal"][2].get<double>());
                if (norm.norm() > 1e-6) norm.normalize();
                else norm = ::Slic3r::Vec3d(0.0, 0.0, 1.0);
            }
            ::Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
            double rotation = args.value("rotation", 0.0);
            double rot_rad = rotation * M_PI / 180.0;
            if (std::abs(rot_rad) > 1e-6) {
                surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
            }
            if (!target_obj->instances.empty()) {
                text_tr = target_obj->instances.front()->get_matrix().inverse() * surface_trmat;
            }
        }
    }

    GeneratedTextMesh generated = generate_text_geometry(
        text, font_data, font_path, font_name, size, depth,
        char_gap, line_gap, boldness, skew, h_align, v_align,
        use_surface, is_new_object, mv_type, sources, text_tr
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

        if (args.contains("rotation")) {
            double rotation = args.value("rotation", 0.0);
            double rot_rad = rotation * M_PI / 180.0;
            new_obj->instances.front()->set_rotation(Slic3r::Vec3d(0.0, 0.0, rot_rad));
        }

        if (!plates.empty() && plates[0]) {
            plates[0]->objects_and_instances.emplace_back(static_cast<int>(model.objects.size() - 1), 0);
        }

        const Slic3r::Transform3d& inst_tr = (!new_obj->instances.empty()) ? new_obj->instances.front()->get_matrix() : Slic3r::Transform3d::Identity();
        new_obj->invalidate_bounding_box();
        const auto bb = new_vol->mesh().transformed_bounding_box(inst_tr * new_vol->get_transformation().get_matrix());
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
        double rot_rad = rotation * M_PI / 180.0;

        Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
        if (std::abs(rot_rad) > 1e-6) {
            surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
        }

        Slic3r::Transform3d vol_tr = target_obj->instances.front()->get_matrix().inverse() * surface_trmat;

        // Like desktop's EmbossJob, keep the mesh in text space: centering it would be lost when the
        // transformation is set below and shift the text off its placement point.
        Slic3r::ModelVolume* new_vol = target_obj->add_volume(std::move(generated.mesh), mv_type, false);
        new_vol->set_transformation(vol_tr);
        new_vol->name = custom_name;
        new_vol->source.is_from_builtin_objects = true;
        new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(0));
        new_vol->text_configuration = std::move(generated.text_config);
        new_vol->emboss_shape = std::move(generated.emboss_shape);

        const Slic3r::Transform3d& inst_tr = (!target_obj->instances.empty()) ? target_obj->instances.front()->get_matrix() : Slic3r::Transform3d::Identity();
        target_obj->invalidate_bounding_box();
        const auto bb = new_vol->mesh().transformed_bounding_box(inst_tr * new_vol->get_transformation().get_matrix());
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

    std::string font_data = "";
    if (args.contains("fontData") && args["fontData"].is_string()) {
        font_data = args["fontData"].get<std::string>();
    }

    std::string font_path = "";
    if (args.contains("fontPath") && args["fontPath"].is_string()) {
        font_path = args["fontPath"].get<std::string>();
    } else if (args.contains("font") && args["font"].is_string()) {
        const std::string& val = args["font"].get<std::string>();
        if (val.size() > 512) font_data = val;
        else font_path = val;
    } else if (existing_tc && font_data.empty()) {
        font_path = existing_tc->style.path;
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

    std::optional<OrcaWasm::surface::ModelSources> sources;
    std::optional<::Slic3r::Transform3d> text_tr = vol->get_transformation().get_matrix();
    if (!is_new_object && obj) {
        OrcaWasm::surface::ModelSources src;
        for (const Slic3r::ModelVolume *v : obj->volumes) {
            if (v->id() == vol->id()) continue;
            if (!v->is_model_part()) continue;
            const Slic3r::TriangleMesh &tm = v->mesh();
            if (tm.empty() || tm.its.empty()) continue;
            src.push_back({v->get_mesh_shared_ptr(), v->get_matrix()});
        }
        sources = std::move(src);

        double rotation = args.value("rotation", 0.0);
        double rot_rad = rotation * M_PI / 180.0;
        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            ::Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
            ::Slic3r::Vec3d norm(0.0, 0.0, 1.0);
            if (args.contains("normal") && args["normal"].is_array() && args["normal"].size() >= 3) {
                norm = ::Slic3r::Vec3d(args["normal"][0].get<double>(), args["normal"][1].get<double>(), args["normal"][2].get<double>());
                if (norm.norm() > 1e-6) norm.normalize();
                else norm = ::Slic3r::Vec3d(0.0, 0.0, 1.0);
            }
            ::Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
            if (std::abs(rot_rad) > 1e-6) {
                surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
            }
            if (!obj->instances.empty()) {
                text_tr = obj->instances.front()->get_matrix().inverse() * surface_trmat;
            }
        } else if (args.contains("rotation")) {
            const ::Slic3r::Transform3d& inst_tr = (!obj->instances.empty()) ? obj->instances.front()->get_matrix() : ::Slic3r::Transform3d::Identity();
            ::Slic3r::Transform3d cur_vol_tr = vol->get_transformation().get_matrix();
            ::Slic3r::Transform3d world_tr = inst_tr * cur_vol_tr;
            ::Slic3r::Vec3d pos = world_tr.translation();
            auto linear_mat = world_tr.linear();
            double scale_x = linear_mat.col(0).norm();
            double scale_y = linear_mat.col(1).norm();
            double scale_z = linear_mat.col(2).norm();
            ::Slic3r::Vec3d norm = linear_mat.col(2);
            if (norm.norm() > 1e-6) norm.normalize();
            else norm = ::Slic3r::Vec3d(0.0, 0.0, 1.0);
            ::Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
            if (std::abs(rot_rad) > 1e-6) {
                surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
            }
            if (std::abs(scale_x - 1.0) > 1e-4 || std::abs(scale_y - 1.0) > 1e-4 || std::abs(scale_z - 1.0) > 1e-4) {
                surface_trmat.scale(::Slic3r::Vec3d(scale_x, scale_y, scale_z));
            }
            text_tr = inst_tr.inverse() * surface_trmat;
        }
    }

    GeneratedTextMesh generated = generate_text_geometry(
        text, font_data, font_path, font_name, size, depth,
        char_gap, line_gap, boldness, skew, h_align, v_align,
        use_surface, is_new_object, vol->type(), sources, text_tr
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

    double rotation = args.value("rotation", 0.0);
    double rot_rad = rotation * M_PI / 180.0;

    if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
        Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
        Slic3r::Vec3d norm(0.0, 0.0, 1.0);
        if (args.contains("normal") && args["normal"].is_array() && args["normal"].size() >= 3) {
            norm = Slic3r::Vec3d(args["normal"][0].get<double>(), args["normal"][1].get<double>(), args["normal"][2].get<double>());
            if (norm.norm() > 1e-6) norm.normalize();
        }

        Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
        if (std::abs(rot_rad) > 1e-6) {
            surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
        }
        Slic3r::Transform3d vol_tr = obj->instances.front()->get_matrix().inverse() * surface_trmat;
        vol->set_transformation(vol_tr);
    } else if (args.contains("rotation")) {
        if (is_new_object && !obj->instances.empty()) {
            obj->instances.front()->set_rotation(Slic3r::Vec3d(0.0, 0.0, rot_rad));
        } else {
            const Slic3r::Transform3d& inst_tr = (!obj->instances.empty()) ? obj->instances.front()->get_matrix() : Slic3r::Transform3d::Identity();
            Slic3r::Transform3d cur_vol_tr = vol->get_transformation().get_matrix();
            Slic3r::Transform3d world_tr = inst_tr * cur_vol_tr;

            Slic3r::Vec3d pos = world_tr.translation();
            auto linear_mat = world_tr.linear();
            double scale_x = linear_mat.col(0).norm();
            double scale_y = linear_mat.col(1).norm();
            double scale_z = linear_mat.col(2).norm();

            Slic3r::Vec3d norm = linear_mat.col(2);
            if (norm.norm() > 1e-6) norm.normalize();
            else norm = Slic3r::Vec3d(0.0, 0.0, 1.0);

            Slic3r::Transform3d surface_trmat = Slic3r::Emboss::create_transformation_onto_surface(pos, norm, 0.9);
            if (std::abs(rot_rad) > 1e-6) {
                surface_trmat *= Eigen::AngleAxisd(rot_rad, Slic3r::Vec3d::UnitZ());
            }
            if (std::abs(scale_x - 1.0) > 1e-4 || std::abs(scale_y - 1.0) > 1e-4 || std::abs(scale_z - 1.0) > 1e-4) {
                surface_trmat.scale(Slic3r::Vec3d(scale_x, scale_y, scale_z));
            }

            Slic3r::Transform3d new_vol_tr = inst_tr.inverse() * surface_trmat;
            vol->set_transformation(new_vol_tr);
        }
    }

    const Slic3r::Transform3d& inst_tr = (!obj->instances.empty()) ? obj->instances.front()->get_matrix() : Slic3r::Transform3d::Identity();
    obj->invalidate_bounding_box();
    const auto bb = vol->mesh().transformed_bounding_box(inst_tr * vol->get_transformation().get_matrix());
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
        }},
        {"rotation", ([&]() -> double {
            const Slic3r::Transform3d& inst_tr = (!obj->instances.empty()) ? obj->instances.front()->get_matrix() : Slic3r::Transform3d::Identity();
            Slic3r::Transform3d world_tr = inst_tr * vol->get_transformation().get_matrix();
            std::optional<float> cur_rot = Slic3r::Emboss::calc_up(world_tr, 0.9);
            return cur_rot.has_value() ? static_cast<double>(*cur_rot) * 180.0 / M_PI : 0.0;
        })()}
    };

    return res;
}

} // namespace OrcaWasm
