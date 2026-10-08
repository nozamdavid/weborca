#include "CutOps.hpp"

#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"
#include "PlateOps.hpp"

#include <cmath>
#include <memory>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

Slic3r::ModelObject* find_object(Slic3r::Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

} // namespace

json cutObject(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = 0;
    if (args.contains("objectId")) {
        object_id = args["objectId"].get<size_t>();
    } else if (args.contains("id")) {
        object_id = args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("cutObject requires objectId");
    }

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    if (obj->instances.empty()) {
        throw Slic3r::RuntimeError("Object has no instances");
    }

    size_t inst_idx = 0;
    if (args.contains("instanceIndex")) {
        inst_idx = args["instanceIndex"].get<size_t>();
    } else if (args.contains("instanceId")) {
        size_t target_inst_id = args["instanceId"].get<size_t>();
        bool found = false;
        for (size_t i = 0; i < obj->instances.size(); ++i) {
            if (obj->instances[i] && obj->instances[i]->id().id == target_inst_id) {
                inst_idx = i;
                found = true;
                break;
            }
        }
        if (!found) {
            throw Slic3r::RuntimeError("Instance not found: " + std::to_string(target_inst_id));
        }
    }

    if (inst_idx >= obj->instances.size() || !obj->instances[inst_idx]) {
        throw Slic3r::RuntimeError("Invalid instance index");
    }

    const auto* inst = obj->instances[inst_idx];
    std::string coord_system = args.value("coordinateSystem", "world");

    // Determine plane point and normal
    Slic3r::Vec3d plane_point = Slic3r::Vec3d::Zero();
    Slic3r::Vec3d plane_normal = Slic3r::Vec3d::UnitZ();

    if (args.contains("plane") && args["plane"].is_object()) {
        const auto& p = args["plane"];
        if (p.contains("point") && p["point"].is_array() && p["point"].size() >= 3) {
            plane_point = Slic3r::Vec3d(p["point"][0].get<double>(), p["point"][1].get<double>(), p["point"][2].get<double>());
        }
        if (p.contains("normal") && p["normal"].is_array() && p["normal"].size() >= 3) {
            plane_normal = Slic3r::Vec3d(p["normal"][0].get<double>(), p["normal"][1].get<double>(), p["normal"][2].get<double>());
        }
    } else if (args.contains("z")) {
        double cut_z = args["z"].get<double>();
        Slic3r::BoundingBoxf3 bb = (coord_system == "object") ? obj->raw_bounding_box() : obj->instance_bounding_box(inst_idx);
        Slic3r::Vec3d center = bb.defined ? bb.center() : Slic3r::Vec3d::Zero();
        plane_point = Slic3r::Vec3d(center.x(), center.y(), cut_z);
        plane_normal = Slic3r::Vec3d::UnitZ();
    } else {
        throw Slic3r::RuntimeError("cutObject requires either 'z' or 'plane'");
    }

    if (coord_system == "object") {
        // Transform point and normal from object local coordinates to world coordinates
        const Slic3r::Transform3d inst_trafo = inst->get_transformation().get_matrix();
        plane_point = inst_trafo * plane_point;
        plane_normal = (inst_trafo.linear().inverse().transpose() * plane_normal);
    }

    if (std::isnan(plane_point.x()) || std::isnan(plane_point.y()) || std::isnan(plane_point.z()) ||
        std::isnan(plane_normal.x()) || std::isnan(plane_normal.y()) || std::isnan(plane_normal.z()) ||
        plane_normal.norm() < 1e-6) {
        return json{
            {"success", false},
            {"error", "Invalid plane coordinates or degenerate normal"},
            {"objectId", object_id}
        };
    }

    plane_normal.normalize();

    // Compute rotation_m mapping (0, 0, 1) to plane_normal
    Slic3r::Transform3d rotation_m = Slic3r::Transform3d::Identity();
    if (std::abs(plane_normal.z() - 1.0) < 1e-6) {
        rotation_m = Slic3r::Transform3d::Identity();
    } else if (std::abs(plane_normal.z() - (-1.0)) < 1e-6) {
        rotation_m = Slic3r::Transform3d(Eigen::AngleAxisd(M_PI, Slic3r::Vec3d::UnitX()));
    } else {
        rotation_m = Slic3r::Transform3d(Eigen::Quaterniond::FromTwoVectors(Slic3r::Vec3d::UnitZ(), plane_normal));
    }

    const Slic3r::Vec3d instance_offset = inst->get_offset();
    const Slic3r::Vec3d cut_center_offset = plane_point - instance_offset;
    const Slic3r::Transform3d cut_matrix = Slic3r::Geometry::translation_transform(cut_center_offset) * rotation_m;

    // Check intersection: in cut space, cut plane is Z = 0
    const Slic3r::Geometry::Transformation cut_transformation(cut_matrix);
    const Slic3r::Transform3d inverse_cut_matrix = cut_transformation.get_rotation_matrix().inverse() *
                                                  Slic3r::Geometry::translation_transform(-1.0 * cut_transformation.get_offset());
    const Slic3r::Transform3d instance_matrix = inst->get_transformation().get_matrix_no_offset();

    Slic3r::BoundingBoxf3 cut_bb;
    for (const auto* v : obj->volumes) {
        if (v && v->is_model_part() && !v->mesh().empty()) {
            cut_bb.merge(v->mesh().transformed_bounding_box(inverse_cut_matrix * instance_matrix * v->get_matrix()));
        }
    }

    if (!cut_bb.defined || cut_bb.min.z() >= -1e-4 || cut_bb.max.z() <= 1e-4) {
        // Plane does not intersect the object interior: preserve original
        return json{
            {"success", false},
            {"error", "Cut plane does not intersect object"},
            {"objectId", object_id}
        };
    }

    bool keep_upper = true;
    bool keep_lower = true;
    if (args.contains("keepMode")) {
        std::string mode = args["keepMode"].get<std::string>();
        if (mode == "upper") {
            keep_upper = true;
            keep_lower = false;
        } else if (mode == "lower") {
            keep_upper = false;
            keep_lower = true;
        } else if (mode == "both") {
            keep_upper = true;
            keep_lower = true;
        }
    }
    if (args.contains("keepUpper")) {
        keep_upper = args["keepUpper"].get<bool>();
    }
    if (args.contains("keepLower")) {
        keep_lower = args["keepLower"].get<bool>();
    }

    if (!keep_upper && !keep_lower) {
        return json{
            {"success", false},
            {"error", "At least one half must be kept"},
            {"objectId", object_id}
        };
    }

    Slic3r::ModelObjectCutAttributes attributes;
    if (keep_upper) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepUpper;
    if (keep_lower) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepLower;

    bool keep_as_parts = args.value("keepAsParts", false);
    if (keep_as_parts) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepAsParts;

    if (args.value("flipUpper", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::FlipUpper;
    if (args.value("flipLower", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::FlipLower;
    if (args.value("placeOnCutUpper", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::PlaceOnCutUpper;
    if (args.value("placeOnCutLower", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::PlaceOnCutLower;
    if (args.value("keepPaint", true)) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepPaint;

    std::unique_ptr<Slic3r::Cut> cut;
    const Slic3r::ModelObjectPtrs* new_objects_ptr = nullptr;
    try {
        cut = std::make_unique<Slic3r::Cut>(obj, static_cast<int>(inst_idx), cut_matrix, attributes);
        new_objects_ptr = &cut->perform_with_plane();
    } catch (const std::exception& e) {
        return json{
            {"success", false},
            {"error", std::string("Cut failed: ") + e.what()},
            {"objectId", object_id}
        };
    }

    const Slic3r::ModelObjectPtrs& new_objects = *new_objects_ptr;

    if (new_objects.empty()) {
        return json{
            {"success", false},
            {"error", "Cut produced no objects"},
            {"objectId", object_id}
        };
    }

    bool all_valid = true;
    for (const auto* no : new_objects) {
        if (!no || no->volumes.empty()) {
            all_valid = false;
            break;
        }
        bool has_mesh = false;
        for (const auto* v : no->volumes) {
            if (v && !v->mesh().empty()) {
                has_mesh = true;
                break;
            }
        }
        if (!has_mesh) {
            all_valid = false;
            break;
        }
    }
    if (!all_valid) {
        return json{
            {"success", false},
            {"error", "Cut produced empty or invalid volumes"},
            {"objectId", object_id}
        };
    }

    std::string orig_name = obj->name;
    size_t orig_id = obj->id().id;

    // Delete original object and add cut objects
    model.delete_object(obj->id());

    json created_objects_json = json::array();

    for (size_t i = 0; i < new_objects.size(); ++i) {
        auto* cut_obj = new_objects[i];
        std::string part_label = "part";
        if (keep_as_parts) {
            part_label = "parts";
            cut_obj->name = orig_name;
        } else if (keep_upper && !keep_lower) {
            part_label = "upper";
            cut_obj->name = orig_name + " - Upper";
        } else if (keep_lower && !keep_upper) {
            part_label = "lower";
            cut_obj->name = orig_name + " - Lower";
        } else if (new_objects.size() == 2) {
            part_label = (i == 0) ? "upper" : "lower";
            cut_obj->name = orig_name + ((i == 0) ? " - Upper" : " - Lower");
        } else {
            // Both requested, 1 produced: check cut space bounds
            Slic3r::BoundingBoxf3 bb_in_cut;
            for (const auto* v : cut_obj->volumes) {
                if (v && !v->mesh().empty()) {
                    bb_in_cut.merge(v->mesh().transformed_bounding_box(inverse_cut_matrix * instance_matrix * v->get_matrix()));
                }
            }
            if (bb_in_cut.center().z() >= 0) {
                part_label = "upper";
                cut_obj->name = orig_name + " - Upper";
            } else {
                part_label = "lower";
                cut_obj->name = orig_name + " - Lower";
            }
        }

        Slic3r::ModelObject* added_obj = model.add_object(*cut_obj);
        added_obj->invalidate_bounding_box();

        double total_vol = 0.0;
        int total_open_edges = 0;
        json volumes_info = json::array();
        for (const auto* v : added_obj->volumes) {
            if (v && !v->mesh().empty()) {
                double v_vol = std::abs(static_cast<double>(Slic3r::its_volume(v->mesh().its)));
                int open_edges = Slic3r::its_num_open_edges(v->mesh().its);
                total_vol += v_vol;
                total_open_edges += open_edges;
                volumes_info.push_back({
                    {"id", v->id().id},
                    {"name", v->name},
                    {"volume", v_vol},
                    {"openEdges", open_edges}
                });
            }
        }

        size_t bb_inst_idx = (inst_idx < added_obj->instances.size()) ? inst_idx : 0;
        Slic3r::BoundingBoxf3 bb = added_obj->instance_bounding_box(bb_inst_idx);

        created_objects_json.push_back({
            {"id", added_obj->id().id},
            {"name", added_obj->name},
            {"part", part_label},
            {"volume", total_vol},
            {"openEdges", total_open_edges},
            {"boundingBox", {
                {"min", {bb.min.x(), bb.min.y(), bb.min.z()}},
                {"max", {bb.max.x(), bb.max.y(), bb.max.z()}}
            }},
            {"volumes", volumes_info}
        });
    }

    // Update plate membership
    OrcaEngine::assignInstancesToPlates(model, plates, config);

    return json{
        {"success", true},
        {"objectId", orig_id},
        {"createdObjects", created_objects_json}
    };
}

} // namespace OrcaWasm
