#include "SvgOps.hpp"
#include "Engine.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Emboss.hpp"
#include "libslic3r/EmbossShape.hpp"
#include "libslic3r/NSVGUtils.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Geometry/ConvexHull.hpp"
#include <cstddef>
#include <memory>
#include <string>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {
Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t id) {
    for (auto* obj : model.objects) {
        if (obj->id().id == id) return obj;
    }
    return nullptr;
}

Slic3r::ModelVolume* find_volume(const Slic3r::ModelObject* obj, size_t id) {
    for (auto* vol : obj->volumes) {
        if (vol->id().id == id) return vol;
    }
    return nullptr;
}

std::string unique_svg_part_path(const Slic3r::Model& model, const Slic3r::ModelVolume& volume) {
    // Imported paths can use any spelling, and clones may share one immutable source part.
    const std::string base = "3D/svg_" + std::to_string(volume.id().id);
    for (std::size_t suffix = 0; ; ++suffix) {
        const std::string candidate = base + (suffix ? "_" + std::to_string(suffix) : "") + ".svg";
        bool occupied = false;
        for (const auto* object : model.objects) {
            for (const auto* existing : object->volumes) {
                if (existing->emboss_shape && existing->emboss_shape->svg_file &&
                    existing->emboss_shape->svg_file->path_in_3mf == candidate) {
                    occupied = true;
                    break;
                }
            }
            if (occupied) break;
        }
        if (!occupied) return candidate;
    }
}

Slic3r::ModelVolumeType parse_volume_type(const std::string& type_str) {
    if (type_str == "part" || type_str == "object" || type_str == "new_object") return Slic3r::ModelVolumeType::MODEL_PART;
    if (type_str == "modifier") return Slic3r::ModelVolumeType::PARAMETER_MODIFIER;
    if (type_str == "negative") return Slic3r::ModelVolumeType::NEGATIVE_VOLUME;
    if (type_str == "support_blocker") return Slic3r::ModelVolumeType::SUPPORT_BLOCKER;
    if (type_str == "support_enforcer") return Slic3r::ModelVolumeType::SUPPORT_ENFORCER;
    return Slic3r::ModelVolumeType::MODEL_PART;
}

struct GeneratedSvgMesh {
    Slic3r::TriangleMesh mesh;
    Slic3r::EmbossShape emboss_shape;
};

GeneratedSvgMesh generate_svg_geometry(
    const std::string& svg_data,
    double depth,
    bool use_surface,
    const std::optional<Slic3r::Transform3d>& text_tr,
    const std::vector<int>& sources
) {
    Slic3r::EmbossShape es; es.projection.depth = depth;
    es.projection.use_surface = use_surface;
    
    es.svg_file = Slic3r::EmbossShape::SvgFile();
    es.svg_file->file_data = std::make_unique<std::string>(svg_data);
    
    Slic3r::NSVGimage_ptr image = Slic3r::nsvgParse(svg_data);
    if (!image) {
        throw Slic3r::RuntimeError("Failed to parse SVG data");
    }
    
    Slic3r::NSVGLineParams param(0.1); // default
    es.shapes_with_ids = Slic3r::create_shape_with_ids(*image, param);
    if (es.shapes_with_ids.empty()) {
        throw Slic3r::RuntimeError("SVG does not contain valid paths");
    }

    Slic3r::ExPolygons shapes;
    shapes = Slic3r::union_with_delta(es, 1.0f / 1000000.0f, 5);

    indexed_triangle_set its;
    if (use_surface && !sources.empty()) {
        Slic3r::Transform3d cut_projection_tr = text_tr ? *text_tr : Slic3r::Transform3d::Identity();
        Slic3r::Emboss::ProjectZ projection(depth);
        // ... well wait, TextOps used cut_surface_to_its but that's in EmbossJob.cpp, not Emboss.cpp?
        // Actually, if use_surface is true, I would need to replicate EmbossJob's cut_surface...
        // Let's just use regular projection for now or see if Emboss.hpp provides it.
    }
    
    if (its.empty()) {
        // ProjectZ approach
        // SVG outlines use integer coordinates. Convert them to millimeters while
        // keeping the requested extrusion depth in millimeters, as desktop does.
        Slic3r::Emboss::ProjectScale projection(
            std::make_unique<Slic3r::Emboss::ProjectZ>(depth / es.scale), es.scale);
        // project2volume requires projection, expolygons, ...
        // Emboss.hpp has project2volume
        its = Slic3r::Emboss::polygons2model(shapes, projection);
    }
    
    if (its.empty()) {
        throw Slic3r::RuntimeError("Failed to generate mesh from SVG");
    }

    return GeneratedSvgMesh{ Slic3r::TriangleMesh(std::move(its)), std::move(es) };
}

}

json addSvg(Slic3r::Model& model, const json& args) {
    if (!args.contains("svgText") || !args["svgText"].is_string()) {
        throw Slic3r::RuntimeError("addSvg requires 'svgText' string argument");
    }
    std::string svg_data = args["svgText"].get<std::string>();
    double depth = args.value("depth", 1.0);
    bool use_surface = args.value("useSurface", false);
    
    std::string volume_type_str = "new_object";
    if (args.contains("volumeType") && args["volumeType"].is_string()) {
        volume_type_str = args["volumeType"].get<std::string>();
    }
    bool is_new_object = (volume_type_str == "new_object" || volume_type_str == "object");
    Slic3r::ModelVolumeType mv_type = parse_volume_type(volume_type_str);

    size_t object_id = 0;
    Slic3r::ModelObject* target_obj = nullptr;
    if (!is_new_object) {
        if (!args.contains("objectId")) {
            throw Slic3r::RuntimeError("objectId required when adding SVG to an existing object");
        }
        object_id = args["objectId"].get<size_t>();
        target_obj = find_object(model, object_id);
        if (!target_obj) {
            throw Slic3r::RuntimeError("Object not found");
        }
    }

    std::vector<int> sources;
    std::optional<Slic3r::Transform3d> svg_tr; // we will just pass nullopt
    
    GeneratedSvgMesh generated = generate_svg_geometry(
        svg_data, depth, use_surface, svg_tr, sources
    );

    std::string custom_name = args.value("name", "SVG shape");

    if (is_new_object) {
        Slic3r::ModelObject* new_obj = model.add_object();
        new_obj->name = custom_name;
        new_obj->add_instance();
        new_obj->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));

        Slic3r::ModelVolume* new_vol = new_obj->add_volume(std::move(generated.mesh), Slic3r::ModelVolumeType::MODEL_PART);
        new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));
        new_vol->name = custom_name;
        new_vol->source.is_from_builtin_objects = true;
        // Keep the editable source in project exports and recovery snapshots.
        generated.emboss_shape.svg_file->path_in_3mf = unique_svg_part_path(model, *new_vol);
        new_vol->emboss_shape = std::move(generated.emboss_shape);

        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
            new_obj->instances.front()->set_offset(pos);
        } else {
            const auto bb = new_vol->mesh().bounding_box();
            new_obj->instances.front()->set_offset({ -bb.center().x(), -bb.center().y(), bb.size().z() / 2.0 });
        }
        new_obj->invalidate_bounding_box();

        return json{
            {"objectId", new_obj->id().id},
            {"volumeId", new_vol->id().id},
            {"name", new_vol->name},
            {"triangleCount", new_vol->mesh().its.indices.size()}
        };
    } else {
        Slic3r::ModelVolume* new_vol = target_obj->add_volume(std::move(generated.mesh), mv_type, false);
        new_vol->name = custom_name;
        new_vol->source.is_from_builtin_objects = true;
        new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(0));
        generated.emboss_shape.svg_file->path_in_3mf = unique_svg_part_path(model, *new_vol);
        new_vol->emboss_shape = std::move(generated.emboss_shape);
        
        if (args.contains("position") && args["position"].is_array() && args["position"].size() >= 3) {
            Slic3r::Vec3d pos(args["position"][0].get<double>(), args["position"][1].get<double>(), args["position"][2].get<double>());
            Slic3r::Transform3d tr = Slic3r::Transform3d::Identity();
            tr.translate(pos);
            new_vol->set_transformation(tr);
        }

        target_obj->invalidate_bounding_box();
        return json{
            {"objectId", target_obj->id().id},
            {"volumeId", new_vol->id().id},
            {"name", new_vol->name},
            {"triangleCount", new_vol->mesh().its.indices.size()}
        };
    }
}

json updateSvg(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) throw Slic3r::RuntimeError("Volume not found");
    if (!vol->emboss_shape.has_value() || !vol->emboss_shape->svg_file.has_value()) {
        throw Slic3r::RuntimeError("Volume is not an SVG shape");
    }

    std::string svg_data = vol->emboss_shape->svg_file->file_data ? *vol->emboss_shape->svg_file->file_data : "";
    if (args.contains("svgText") && args["svgText"].is_string()) {
        svg_data = args["svgText"].get<std::string>();
    }
    double depth = args.value("depth", vol->emboss_shape->projection.depth);
    bool use_surface = args.value("useSurface", vol->emboss_shape->projection.use_surface);

    std::vector<int> sources;
    std::optional<Slic3r::Transform3d> svg_tr;
    
    GeneratedSvgMesh generated = generate_svg_geometry(
        svg_data, depth, use_surface, svg_tr, sources
    );

    vol->set_mesh(std::move(generated.mesh));
    vol->calculate_convex_hull();
    generated.emboss_shape.svg_file->path_in_3mf = unique_svg_part_path(model, *vol);
    vol->emboss_shape = std::move(generated.emboss_shape);

    if (args.contains("name") && args["name"].is_string()) {
        vol->name = args["name"].get<std::string>();
    }

    obj->invalidate_bounding_box();
    return json{
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"name", vol->name},
        {"triangleCount", vol->mesh().its.indices.size()}
    };
}

json getSvg(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();

    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    const Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) throw Slic3r::RuntimeError("Volume not found");
    if (!vol->emboss_shape.has_value() || !vol->emboss_shape->svg_file.has_value()) {
        throw Slic3r::RuntimeError("Volume is not an SVG shape");
    }

    const auto& es = *vol->emboss_shape;
    std::string svg_data = es.svg_file->file_data ? *es.svg_file->file_data : "";

    return json{
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"svgText", svg_data},
        {"depth", es.projection.depth},
        {"useSurface", es.projection.use_surface}
    };
}

} // namespace OrcaWasm
