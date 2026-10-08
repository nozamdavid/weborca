#include "CutConnectorOps.hpp"

#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/libslic3r.h"
#include "PlateOps.hpp"

#include <cmath>
#include <memory>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include <utility>
#include <exception>

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

std::string to_lower(std::string str) {
    std::transform(str.begin(), str.end(), str.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return str;
}

struct ParsedConnector {
    Slic3r::Vec3d pos{ Slic3r::Vec3d::Zero() };
    Slic3r::CutConnectorAttributes attrs;
    double radius{ 2.5 };
    double height{ 5.0 };
    double radius_tolerance{ 0.1 };
    double height_tolerance{ 0.1 };
    double z_angle{ 0.0 };
    std::string target_half{ "upper" };
};

indexed_triangle_set get_connector_mesh(const Slic3r::CutConnectorAttributes& connector_attributes)
{
    int sectorCount = 360;
    switch (connector_attributes.shape) {
    case Slic3r::CutConnectorShape::Triangle:
        sectorCount = 3;
        break;
    case Slic3r::CutConnectorShape::Square:
        sectorCount = 4;
        break;
    case Slic3r::CutConnectorShape::Hexagon:
        sectorCount = 6;
        break;
    case Slic3r::CutConnectorShape::Circle:
    default:
        sectorCount = 360;
        break;
    }

    if (connector_attributes.type == Slic3r::CutConnectorType::Snap)
        return Slic3r::its_make_snap(1.0, 1.0, 0.3f, 0.15f);
    else if (connector_attributes.style == Slic3r::CutConnectorStyle::Prism)
        return Slic3r::its_make_cylinder(1.0, 1.0, (2.0 * M_PI / sectorCount));
    else if (connector_attributes.type == Slic3r::CutConnectorType::Plug)
        return Slic3r::its_make_frustum(1.0, 1.0, (2.0 * M_PI / sectorCount));
    else
        return Slic3r::its_make_frustum_dowel(1.0, 1.0, sectorCount);
}

void apply_connector_tolerance(Slic3r::ModelVolume* vol, double direction = 1.0)
{
    if (!vol) return;
    Slic3r::ModelVolume::CutInfo& cut_info = vol->cut_info;
    if (!cut_info.is_connector)
        return;

    Slic3r::Vec3d sf = vol->get_scaling_factor();
    sf[Slic3r::X] += direction * double(cut_info.radius_tolerance);
    sf[Slic3r::Y] += direction * double(cut_info.radius_tolerance);
    sf[Slic3r::Z] += direction * double(cut_info.height_tolerance);
    vol->set_scaling_factor(sf);

    Slic3r::Vec3d rot_norm = Slic3r::Geometry::rotation_transform(vol->get_rotation()) * Slic3r::Vec3d::UnitZ();
    if (rot_norm.norm() != 0.0)
        rot_norm.normalize();

    double z_offset = 0.5 * static_cast<double>(cut_info.height_tolerance);
    if (cut_info.connector_type == Slic3r::CutConnectorType::Plug ||
        cut_info.connector_type == Slic3r::CutConnectorType::Snap)
        z_offset -= 0.05;

    vol->set_offset(vol->get_offset() + rot_norm * (direction * z_offset));
}

} // namespace

static json cut_candidate(
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
        throw Slic3r::RuntimeError("cutObjectWithConnectors requires objectId");
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
    if (coord_system != "world" && coord_system != "object")
        throw Slic3r::RuntimeError("coordinateSystem must be world or object");

    // Determine plane point and normal
    Slic3r::Vec3d plane_point = Slic3r::Vec3d::Zero();
    Slic3r::Vec3d plane_normal = Slic3r::Vec3d::UnitZ();

    if (args.contains("plane") && args["plane"].is_object()) {
        const auto& p = args["plane"];
        if (!p.contains("point") || !p["point"].is_array() || p["point"].size() != 3 ||
            !p.contains("normal") || !p["normal"].is_array() || p["normal"].size() != 3)
            throw Slic3r::RuntimeError("plane requires three-component point and normal");
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
        throw Slic3r::RuntimeError("cutObjectWithConnectors requires either 'z' or 'plane'");
    }

    const Slic3r::Transform3d inst_trafo = inst->get_transformation().get_matrix();
    if (!inst_trafo.matrix().allFinite() || std::abs(inst_trafo.linear().determinant()) < 1e-12)
        throw Slic3r::RuntimeError("Instance transform must be finite and invertible");
    if (coord_system == "object") {
        plane_point = inst_trafo * plane_point;
        plane_normal = (inst_trafo.linear().inverse().transpose() * plane_normal);
    }

    if (!plane_point.allFinite() || !plane_normal.allFinite() ||
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

    // Parse connectors
    std::vector<ParsedConnector> parsed_connectors;
    if (args.contains("connectors") && !args["connectors"].is_array())
        throw Slic3r::RuntimeError("connectors must be an array");
    if (args.contains("connectors") && args["connectors"].is_array()) {
        for (const auto& conn_json : args["connectors"]) {
            if (!conn_json.is_object()) throw Slic3r::RuntimeError("Connector must be an object");

            ParsedConnector pc;
            if (!conn_json.contains("pos") && !conn_json.contains("position"))
                throw Slic3r::RuntimeError("Connector requires pos or position");
            const auto& position = conn_json.contains("pos") ? conn_json["pos"] : conn_json["position"];
            if (!position.is_array() || position.size() != 3)
                throw Slic3r::RuntimeError("Connector position must have three components");
            Slic3r::Vec3d raw_pos = Slic3r::Vec3d::Zero();
            if (conn_json.contains("pos") && conn_json["pos"].is_array() && conn_json["pos"].size() >= 3) {
                raw_pos = Slic3r::Vec3d(conn_json["pos"][0].get<double>(), conn_json["pos"][1].get<double>(), conn_json["pos"][2].get<double>());
            } else if (conn_json.contains("position") && conn_json["position"].is_array() && conn_json["position"].size() >= 3) {
                raw_pos = Slic3r::Vec3d(conn_json["position"][0].get<double>(), conn_json["position"][1].get<double>(), conn_json["position"][2].get<double>());
            }

            if (coord_system == "object") {
                Slic3r::Vec3d pos_world = inst_trafo * raw_pos;
                pc.pos = pos_world - instance_offset;
            } else {
                pc.pos = raw_pos - instance_offset;
            }

            const json& attrs = conn_json.contains("attrs") && conn_json["attrs"].is_object() ? conn_json["attrs"] : conn_json;

            // Type
            std::string type_s = to_lower(attrs.value("type", "plug"));
            if (type_s == "dowel") {
                pc.attrs.type = Slic3r::CutConnectorType::Dowel;
            } else if (type_s == "snap") {
                pc.attrs.type = Slic3r::CutConnectorType::Snap;
            } else {
                pc.attrs.type = Slic3r::CutConnectorType::Plug;
            }

            // Style
            std::string style_s = to_lower(attrs.value("style", "prism"));
            if (style_s == "frustum") {
                pc.attrs.style = Slic3r::CutConnectorStyle::Frustum;
            } else {
                pc.attrs.style = Slic3r::CutConnectorStyle::Prism;
            }

            // Shape
            std::string shape_s = to_lower(attrs.value("shape", "circle"));
            if (shape_s == "triangle") {
                pc.attrs.shape = Slic3r::CutConnectorShape::Triangle;
            } else if (shape_s == "square") {
                pc.attrs.shape = Slic3r::CutConnectorShape::Square;
            } else if (shape_s == "hexagon") {
                pc.attrs.shape = Slic3r::CutConnectorShape::Hexagon;
            } else {
                pc.attrs.shape = Slic3r::CutConnectorShape::Circle;
            }

            // Dimensions
            double size_val = attrs.value("size", attrs.value("diameter", 3.0));
            if (attrs.contains("radius")) {
                pc.radius = attrs["radius"].get<double>();
            } else {
                pc.radius = 0.5 * size_val;
            }

            pc.height = attrs.value("depthRatio", attrs.value("depth", attrs.value("height", 4.0)));

            double rot_deg = attrs.value("rotationDeg", attrs.value("rotation", attrs.value("angle", 0.0)));
            pc.z_angle = rot_deg * (M_PI / 180.0);

            double tol = attrs.value("tolerance", 0.1);
            pc.radius_tolerance = attrs.value("radiusTolerance", 0.5 * tol);
            pc.height_tolerance = attrs.value("heightTolerance", tol);

            pc.target_half = to_lower(attrs.value("targetHalf", attrs.value("plugHalf", "upper")));

            if (type_s != "plug" && type_s != "dowel" && type_s != "snap")
                throw Slic3r::RuntimeError("Unknown connector type");
            if (style_s != "prism" && style_s != "frustum")
                throw Slic3r::RuntimeError("Unknown connector style");
            if (shape_s != "triangle" && shape_s != "square" && shape_s != "hexagon" && shape_s != "circle")
                throw Slic3r::RuntimeError("Unknown connector shape");
            if (!pc.pos.allFinite() || !std::isfinite(pc.radius) || pc.radius <= 0 ||
                !std::isfinite(pc.height) || pc.height <= 0 || !std::isfinite(pc.z_angle) ||
                !std::isfinite(pc.radius_tolerance) || pc.radius_tolerance < 0 ||
                !std::isfinite(pc.height_tolerance) || pc.height_tolerance < 0)
                throw Slic3r::RuntimeError("Connector dimensions must be finite and positive, tolerances nonnegative");
            if (pc.target_half != "upper" && pc.target_half != "lower")
                throw Slic3r::RuntimeError("targetHalf must be upper or lower");
            if (pc.attrs.type == Slic3r::CutConnectorType::Snap &&
                (pc.target_half != "lower" || style_s != "prism" || shape_s != "circle"))
                throw Slic3r::RuntimeError("Snap requires lower targetHalf, prism style and circle shape");
            if (std::abs((pc.pos - cut_center_offset).dot(plane_normal)) > 1e-4)
                throw Slic3r::RuntimeError("Connector position must lie on the cut plane");
            const Slic3r::Vec3d cut_pos = inverse_cut_matrix * pc.pos;
            const double envelope_radius = pc.radius + pc.radius_tolerance;
            if (cut_pos.x() - envelope_radius < cut_bb.min.x() || cut_pos.x() + envelope_radius > cut_bb.max.x() ||
                cut_pos.y() - envelope_radius < cut_bb.min.y() || cut_pos.y() + envelope_radius > cut_bb.max.y())
                throw Slic3r::RuntimeError("Connector envelope extends outside the cut-space bounding box");

            parsed_connectors.push_back(pc);
        }
    }

    // CutUtils passes a null lower object in KeepAsParts mode, but its connector
    // path dereferences lower. Single-half role conversion is also unsupported.
    if (!parsed_connectors.empty() && (args.value("keepAsParts", false) || !keep_upper || !keep_lower))
        throw Slic3r::RuntimeError("Connectors require both halves and keepAsParts:false");

    // Isolate working model so original object is 100% untouched on failure
    Slic3r::Model temp_model;
    Slic3r::ModelObject* cut_mo = temp_model.add_object(*obj);

    int dowels_count = 0;
    const size_t connector_id_base = cut_mo->cut_id.connectors_cnt();
    size_t connector_volume_id = connector_id_base;
    for (const auto& pc : parsed_connectors) {
        Slic3r::Vec3d c_pos = pc.pos;
        const bool upper_plug = pc.attrs.type == Slic3r::CutConnectorType::Plug && pc.target_half == "upper";
        const Slic3r::Transform3d connector_rotation = rotation_m * (upper_plug ?
            Slic3r::Transform3d(Eigen::AngleAxisd(M_PI, Slic3r::Vec3d::UnitX())) :
            Slic3r::Transform3d::Identity());
        double c_height = pc.height;

        if (pc.attrs.type == Slic3r::CutConnectorType::Dowel) {
            if (pc.attrs.style == Slic3r::CutConnectorStyle::Prism)
                c_height *= 2.0;
            dowels_count++;
        } else {
            c_pos += (connector_rotation.linear() * Slic3r::Vec3d::UnitZ()) * 0.5 * c_height;
        }

        Slic3r::TriangleMesh mesh(get_connector_mesh(pc.attrs));
        Slic3r::ModelVolume* new_volume = cut_mo->add_volume(std::move(mesh), Slic3r::ModelVolumeType::NEGATIVE_VOLUME);

        Slic3r::Transform3d vol_trafo = Slic3r::Geometry::translation_transform(c_pos) * connector_rotation *
            Slic3r::Geometry::rotation_transform(-pc.z_angle * Slic3r::Vec3d::UnitZ()) *
            Slic3r::Geometry::scale_transform(Slic3r::Vec3d(pc.radius, pc.radius, c_height));

        new_volume->set_transformation(vol_trafo);
        new_volume->cut_info = { pc.attrs.type, static_cast<float>(pc.radius_tolerance), static_cast<float>(pc.height_tolerance), false };
        new_volume->name = "Connector-" + std::to_string(++connector_volume_id);
    }
    cut_mo->cut_id.increase_connectors_cnt(parsed_connectors.size());

    bool keep_as_parts = args.value("keepAsParts", false);
    Slic3r::ModelObjectCutAttributes attributes;
    if (keep_upper) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepUpper;
    if (keep_lower) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepLower;
    if (keep_as_parts) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepAsParts;
    if (args.value("flipUpper", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::FlipUpper;
    if (args.value("flipLower", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::FlipLower;
    if (args.value("placeOnCutUpper", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::PlaceOnCutUpper;
    if (args.value("placeOnCutLower", false)) attributes = attributes | Slic3r::ModelObjectCutAttribute::PlaceOnCutLower;
    if (args.value("keepPaint", true)) attributes = attributes | Slic3r::ModelObjectCutAttribute::KeepPaint;
    if (dowels_count > 0) attributes = attributes | Slic3r::ModelObjectCutAttribute::CreateDowels;

    std::unique_ptr<Slic3r::Cut> cut;
    const Slic3r::ModelObjectPtrs* new_objects_ptr = nullptr;
    try {
        cut = std::make_unique<Slic3r::Cut>(cut_mo, static_cast<int>(inst_idx), cut_matrix, attributes);
        new_objects_ptr = &cut->perform_with_plane();
    } catch (const std::exception& e) {
        return json{
            {"success", false},
            {"error", std::string("Cut with connectors failed: ") + e.what()},
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

    // Adjust connector roles for Plug connectors according to target_half ("upper" default vs "lower")
    if (new_objects.size() >= 2 && !parsed_connectors.empty()) {
        auto* upper_cand = new_objects[0];
        auto* lower_cand = new_objects[1];

        for (size_t c_idx = 0; c_idx < parsed_connectors.size(); ++c_idx) {
            const auto& pc = parsed_connectors[c_idx];
            if (pc.attrs.type == Slic3r::CutConnectorType::Plug && pc.target_half == "upper") {
                // Find matching connector volume in upper and lower
                std::string conn_vol_name = "Connector-" + std::to_string(connector_id_base + c_idx + 1);

                Slic3r::ModelVolume* u_vol = nullptr;
                for (auto* v : upper_cand->volumes) {
                    if (v && (v->name == conn_vol_name && v->cut_info.is_connector)) {
                        u_vol = v;
                        break;
                    }
                }

                Slic3r::ModelVolume* l_vol = nullptr;
                for (auto* v : lower_cand->volumes) {
                    if (v && (v->name == conn_vol_name && v->cut_info.is_connector)) {
                        l_vol = v;
                        break;
                    }
                }

                if (!u_vol || !l_vol)
                    throw Slic3r::RuntimeError("Cut lost a connector counterpart");
                {
                    // Upper gains positive peg geometry at nominal scale
                    u_vol->set_type(Slic3r::ModelVolumeType::MODEL_PART);
                    apply_connector_tolerance(u_vol, -1.0);

                    // Lower gets matching negative hole geometry with tolerance applied
                    l_vol->set_type(Slic3r::ModelVolumeType::NEGATIVE_VOLUME);
                    apply_connector_tolerance(l_vol);
                }
            }
        }
    }

    std::string orig_name = obj->name;
    size_t orig_id = obj->id().id;

    // Delete original object and add cut objects
    model.delete_object(obj->id());

    json created_objects_json = json::array();

    for (size_t i = 0; i < new_objects.size(); ++i) {
        auto* cut_obj = new_objects[i];
        std::string part_label = "part";

        if (cut_obj->name.find("-Dowel-") != std::string::npos) {
            part_label = "dowel";
        } else if (keep_as_parts) {
            part_label = "parts";
            cut_obj->name = orig_name;
        } else if (keep_upper && !keep_lower) {
            part_label = "upper";
            cut_obj->name = orig_name + " - Upper";
        } else if (keep_lower && !keep_upper) {
            part_label = "lower";
            cut_obj->name = orig_name + " - Lower";
        } else if (new_objects.size() >= 2 && i < 2) {
            part_label = (i == 0) ? "upper" : "lower";
            cut_obj->name = orig_name + ((i == 0) ? " - Upper" : " - Lower");
        } else {
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
                double base_vol = std::abs(static_cast<double>(Slic3r::its_volume(v->mesh().its)));
                double scale = std::abs(v->get_matrix().linear().determinant());
                double v_vol = base_vol * scale;

                int open_edges = Slic3r::its_num_open_edges(v->mesh().its);
                total_open_edges += open_edges;

                bool is_negative = (v->type() == Slic3r::ModelVolumeType::NEGATIVE_VOLUME);
                if (is_negative) {
                    total_vol -= v_vol;
                } else if (v->is_model_part()) {
                    total_vol += v_vol;
                }

                const auto volume_bb = v->mesh().transformed_bounding_box(
                    added_obj->instances[inst_idx]->get_matrix() * v->get_matrix());
                volumes_info.push_back({
                    {"id", v->id().id},
                    {"name", v->name},
                    {"type", Slic3r::ModelVolume::type_to_string(v->type())},
                    {"volume", is_negative ? -v_vol : v_vol},
                    {"scalingFactor", {v->get_scaling_factor().x(), v->get_scaling_factor().y(), v->get_scaling_factor().z()}},
                    {"offset", {v->get_offset().x(), v->get_offset().y(), v->get_offset().z()}},
                    {"boundingBox", {{"min", {volume_bb.min.x(), volume_bb.min.y(), volume_bb.min.z()}},
                                     {"max", {volume_bb.max.x(), volume_bb.max.y(), volume_bb.max.z()}}}},
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
            {"volumeIsBooleanResult", false},
            {"openEdges", total_open_edges},
            {"boundingBox", {
                {"min", {bb.min.x(), bb.min.y(), bb.min.z()}},
                {"max", {bb.max.x(), bb.max.y(), bb.max.z()}}
            }},
            {"volumes", volumes_info}
        });
    }

    // Update plate membership if plates were provided
    if (!plates.empty()) {
        OrcaEngine::assignInstancesToPlates(model, plates, config);
    }

    return json{
        {"success", true},
        {"objectId", orig_id},
        {"connectorCount", static_cast<int>(parsed_connectors.size())},
        {"fitValidated", false},
        {"createdObjects", created_objects_json}
    };
}

json cutObjectWithConnectors(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    Slic3r::Model candidate(model);
    // Plate assignment only writes objects_and_instances. Stage those writes too.
    std::vector<Slic3r::PlateData> staged(plates.size());
    Slic3r::PlateDataPtrs staged_ptrs;
    for (auto& plate : staged)
        staged_ptrs.push_back(&plate);
    json result = cut_candidate(candidate, staged_ptrs, config, args);
    if (result.value("success", false)) {
        model = std::move(candidate);
        for (size_t i = 0; i < plates.size(); ++i)
            plates[i]->objects_and_instances.swap(staged[i].objects_and_instances);
    }
    return result;
}

json cutObjectWithConnectors(
    Slic3r::Model& model,
    const json& args
) {
    Slic3r::PlateDataPtrs empty_plates;
    Slic3r::DynamicPrintConfig empty_config;
    return cutObjectWithConnectors(model, empty_plates, empty_config, args);
}

} // namespace OrcaWasm
