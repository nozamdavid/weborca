#include "PaintToolsOps.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleSelector.hpp"
#include "libslic3r/Utils.hpp"

#include <cereal/archives/binary.hpp>
#include <cereal/types/vector.hpp>
#include <cereal/external/base64.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
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

const Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t object_id) {
    for (const auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

template <typename VolPtr, typename ObjPtr>
VolPtr find_volume_impl(ObjPtr obj, const json& args) {
    if (!obj) return nullptr;
    if (args.contains("volumeId") && !args["volumeId"].is_null()) {
        if (!args["volumeId"].is_number_integer() && !args["volumeId"].is_number_unsigned()) {
            throw Slic3r::RuntimeError("volumeId must be an integer");
        }
        size_t vol_id = args["volumeId"].get<size_t>();
        for (auto* vol : obj->volumes) {
            if (vol && vol->id().id == vol_id)
                return vol;
        }
        return nullptr;
    }
    if (args.contains("volumeIndex") && !args["volumeIndex"].is_null()) {
        if (!args["volumeIndex"].is_number_integer()) {
            throw Slic3r::RuntimeError("volumeIndex must be an integer");
        }
        int idx = args["volumeIndex"].get<int>();
        if (idx >= 0 && idx < static_cast<int>(obj->volumes.size()))
            return obj->volumes[idx];
        return nullptr;
    }
    VolPtr part_vol = nullptr;
    int part_count = 0;
    for (auto* vol : obj->volumes) {
        if (vol && vol->is_model_part()) {
            part_vol = vol;
            part_count++;
        }
    }
    if (part_count == 1)
        return part_vol;
    if (obj->volumes.size() == 1)
        return obj->volumes[0];
    return nullptr;
}

Slic3r::ModelVolume* find_volume(Slic3r::ModelObject* obj, const json& args) {
    return find_volume_impl<Slic3r::ModelVolume*, Slic3r::ModelObject*>(obj, args);
}

const Slic3r::ModelVolume* find_volume(const Slic3r::ModelObject* obj, const json& args) {
    return find_volume_impl<const Slic3r::ModelVolume*, const Slic3r::ModelObject*>(obj, args);
}

Slic3r::FacetsAnnotation& get_annotation(Slic3r::ModelVolume& vol, const std::string& layer) {
    if (layer == "support") return vol.supported_facets;
    if (layer == "seam") return vol.seam_facets;
    if (layer == "color" || layer == "mmu") return vol.mmu_segmentation_facets;
    if (layer == "fuzzy" || layer == "fuzzy_skin") return vol.fuzzy_skin_facets;
    throw Slic3r::RuntimeError("Invalid paint layer: " + layer);
}

const Slic3r::FacetsAnnotation& get_annotation(const Slic3r::ModelVolume& vol, const std::string& layer) {
    if (layer == "support") return vol.supported_facets;
    if (layer == "seam") return vol.seam_facets;
    if (layer == "color" || layer == "mmu") return vol.mmu_segmentation_facets;
    if (layer == "fuzzy" || layer == "fuzzy_skin") return vol.fuzzy_skin_facets;
    throw Slic3r::RuntimeError("Invalid paint layer: " + layer);
}

std::string state_to_string(const std::string& layer, Slic3r::EnforcerBlockerType state) {
    if (state == Slic3r::EnforcerBlockerType::NONE)
        return "none";

    if (layer == "support" || layer == "seam") {
        if (state == Slic3r::EnforcerBlockerType::ENFORCER) return "enforcer";
        if (state == Slic3r::EnforcerBlockerType::BLOCKER) return "blocker";
        return "none";
    }
    if (layer == "fuzzy" || layer == "fuzzy_skin") {
        if (state == Slic3r::EnforcerBlockerType::FUZZY_SKIN) return "fuzzy";
        return "none";
    }
    if (layer == "color" || layer == "mmu") {
        return std::to_string(static_cast<int>(state));
    }
    return "none";
}

Slic3r::EnforcerBlockerType parse_state(const std::string& layer, const json& state_val) {
    if (layer == "support" || layer == "seam") {
        if (state_val.is_number_integer()) {
            int v = state_val.get<int>();
            if (v == 0) return Slic3r::EnforcerBlockerType::NONE;
            if (v == 1) return Slic3r::EnforcerBlockerType::ENFORCER;
            if (v == 2) return Slic3r::EnforcerBlockerType::BLOCKER;
        } else if (state_val.is_string()) {
            std::string s = state_val.get<std::string>();
            if (s == "none" || s == "clear" || s == "neutral" || s == "reset" || s == "0")
                return Slic3r::EnforcerBlockerType::NONE;
            if (s == "enforcer" || s == "support_enforcer" || s == "seam_enforcer" || s == "1")
                return Slic3r::EnforcerBlockerType::ENFORCER;
            if (s == "blocker" || s == "support_blocker" || s == "seam_blocker" || s == "2")
                return Slic3r::EnforcerBlockerType::BLOCKER;
        }
        throw Slic3r::RuntimeError("Invalid state for " + layer + ": " + state_val.dump());
    }

    if (layer == "fuzzy" || layer == "fuzzy_skin") {
        if (state_val.is_number_integer()) {
            int v = state_val.get<int>();
            if (v == 0) return Slic3r::EnforcerBlockerType::NONE;
            if (v == 1) return Slic3r::EnforcerBlockerType::FUZZY_SKIN;
        } else if (state_val.is_string()) {
            std::string s = state_val.get<std::string>();
            if (s == "none" || s == "clear" || s == "0")
                return Slic3r::EnforcerBlockerType::NONE;
            if (s == "fuzzy" || s == "fuzzy_skin" || s == "enforcer" || s == "1")
                return Slic3r::EnforcerBlockerType::FUZZY_SKIN;
        }
        throw Slic3r::RuntimeError("Invalid state for fuzzy layer: " + state_val.dump());
    }

    if (layer == "color" || layer == "mmu") {
        if (state_val.is_number_integer()) {
            int v = state_val.get<int>();
            if (v == 0) return Slic3r::EnforcerBlockerType::NONE;
            if (v >= 1 && v <= static_cast<int>(Slic3r::EnforcerBlockerType::ExtruderMax))
                return static_cast<Slic3r::EnforcerBlockerType>(v);
        } else if (state_val.is_string()) {
            std::string s = state_val.get<std::string>();
            if (s == "none" || s == "clear" || s == "0")
                return Slic3r::EnforcerBlockerType::NONE;
            try {
                int v = std::stoi(s);
                if (v >= 1 && v <= static_cast<int>(Slic3r::EnforcerBlockerType::ExtruderMax))
                    return static_cast<Slic3r::EnforcerBlockerType>(v);
            } catch (...) {}
        }
        throw Slic3r::RuntimeError("Invalid filament state for color layer: " + state_val.dump());
    }

    throw Slic3r::RuntimeError("Invalid layer: " + layer);
}

std::vector<Slic3r::EnforcerBlockerType> get_layer_states(const std::string& layer) {
    std::vector<Slic3r::EnforcerBlockerType> states;
    if (layer == "support" || layer == "seam") {
        states.push_back(Slic3r::EnforcerBlockerType::ENFORCER);
        states.push_back(Slic3r::EnforcerBlockerType::BLOCKER);
    } else if (layer == "fuzzy" || layer == "fuzzy_skin") {
        states.push_back(Slic3r::EnforcerBlockerType::FUZZY_SKIN);
    } else if (layer == "color" || layer == "mmu") {
        for (int i = 1; i <= static_cast<int>(Slic3r::EnforcerBlockerType::ExtruderMax); ++i) {
            states.push_back(static_cast<Slic3r::EnforcerBlockerType>(i));
        }
    }
    return states;
}

json compute_layer_stats(const Slic3r::TriangleSelector& selector, const std::string& layer) {
    json stats = json::object();
    if (layer == "support" || layer == "seam") {
        stats["enforcer"] = selector.num_facets(Slic3r::EnforcerBlockerType::ENFORCER);
        stats["blocker"] = selector.num_facets(Slic3r::EnforcerBlockerType::BLOCKER);
    } else if (layer == "fuzzy" || layer == "fuzzy_skin") {
        stats["fuzzy"] = selector.num_facets(Slic3r::EnforcerBlockerType::FUZZY_SKIN);
    } else if (layer == "color" || layer == "mmu") {
        for (int i = 1; i <= static_cast<int>(Slic3r::EnforcerBlockerType::ExtruderMax); ++i) {
            int cnt = selector.num_facets(static_cast<Slic3r::EnforcerBlockerType>(i));
            if (cnt > 0) {
                stats[std::to_string(i)] = cnt;
            }
        }
    }
    return stats;
}

std::string serialize_splitting_data_base64(const Slic3r::TriangleSelector::TriangleSplittingData& data) {
    std::ostringstream oss(std::ios::binary);
    {
        cereal::BinaryOutputArchive oar(oss);
        oar(data);
    }
    std::string bin = oss.str();
    return cereal::base64::encode(reinterpret_cast<const unsigned char*>(bin.data()), bin.size());
}

Slic3r::TriangleSelector::TriangleSplittingData deserialize_splitting_data_base64(const std::string& b64) {
    std::string bin = cereal::base64::decode(b64);
    std::istringstream iss(bin, std::ios::binary);
    Slic3r::TriangleSelector::TriangleSplittingData data;
    {
        cereal::BinaryInputArchive iar(iss);
        iar(data);
    }
    return data;
}

} // namespace

json paintStroke(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("paintStroke requires objectId");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Cannot paint on non-model-part volume");
    }

    if (!args.contains("layer") || !args["layer"].is_string()) {
        throw Slic3r::RuntimeError("paintStroke requires layer");
    }
    std::string layer = args["layer"].get<std::string>();

    if (!args.contains("state")) {
        throw Slic3r::RuntimeError("paintStroke requires state");
    }
    Slic3r::EnforcerBlockerType new_state = parse_state(layer, args["state"]);

    std::string tool = "circle";
    if (args.contains("tool") && args["tool"].is_string()) {
        tool = args["tool"].get<std::string>();
    }

    float radius = 2.0f;
    if (args.contains("radius") && args["radius"].is_number()) {
        radius = args["radius"].get<float>();
    }

    bool triangle_splitting = true;
    if (args.contains("triangleSplitting") && args["triangleSplitting"].is_boolean()) {
        triangle_splitting = args["triangleSplitting"].get<bool>();
    }

    float overhang_angle_deg = 0.f;
    if (layer == "support" && args.contains("overhangAngleDeg") && args["overhangAngleDeg"].is_number()) {
        overhang_angle_deg = args["overhangAngleDeg"].get<float>();
    }

    float smart_fill_angle_deg = 30.f;
    if (args.contains("smartFillAngleDeg") && args["smartFillAngleDeg"].is_number()) {
        smart_fill_angle_deg = args["smartFillAngleDeg"].get<float>();
    }

    bool bucket_propagate = true;
    if (args.contains("bucketPropagate") && args["bucketPropagate"].is_boolean()) {
        bucket_propagate = args["bucketPropagate"].get<bool>();
    }

    // Transformations
    Slic3r::Transform3d instance_trafo = Slic3r::Transform3d::Identity();
    Slic3r::Transform3d instance_trafo_not_translate = Slic3r::Transform3d::Identity();

    if (!obj->instances.empty()) {
        const Slic3r::ModelInstance* target_instance = nullptr;
        if (args.contains("instanceId") && !args["instanceId"].is_null()) {
            size_t inst_id = args["instanceId"].get<size_t>();
            for (const auto* inst : obj->instances) {
                if (inst && inst->id().id == inst_id) {
                    target_instance = inst;
                    break;
                }
            }
        }
        if (!target_instance) {
            target_instance = obj->instances.front();
        }
        instance_trafo = target_instance->get_transformation().get_matrix();
        instance_trafo_not_translate = target_instance->get_transformation().get_matrix_no_offset();
    }

    Slic3r::Transform3d trafo_matrix = instance_trafo * vol->get_matrix();
    Slic3r::Transform3d trafo_matrix_not_translate = instance_trafo_not_translate * vol->get_matrix_no_offset();

    // Camera pos in mesh coordinates
    Slic3r::Vec3f camera_pos(0.f, 0.f, 1000.f);
    if (args.contains("cameraPos") && args["cameraPos"].is_array() && args["cameraPos"].size() >= 3) {
        Slic3r::Vec3d cam_world(
            args["cameraPos"][0].get<double>(),
            args["cameraPos"][1].get<double>(),
            args["cameraPos"][2].get<double>()
        );
        camera_pos = (trafo_matrix.inverse() * cam_world).cast<float>();
    } else {
        camera_pos = (trafo_matrix.inverse() * Slic3r::Vec3d(0.0, 0.0, 1000.0)).cast<float>();
    }

    // Clipping plane in volume coordinates
    Slic3r::TriangleSelector::ClippingPlane clp;
    if (args.contains("clippingPlane") && !args["clippingPlane"].is_null() && args["clippingPlane"].is_object()) {
        const auto& cp = args["clippingPlane"];
        if (cp.contains("normal") && cp.contains("offset")) {
            Slic3r::Vec3d clp_normal(
                cp["normal"][0].get<double>(),
                cp["normal"][1].get<double>(),
                cp["normal"][2].get<double>()
            );
            clp_normal.normalize();
            double clp_offset = cp["offset"].get<double>();

            const Slic3r::Transform3d trafo_normal = Slic3r::Transform3d(trafo_matrix.linear().transpose());
            const Slic3r::Transform3d trafo_inv = trafo_matrix.inverse();

            Slic3r::Vec3d point_on_plane = clp_normal * clp_offset;
            Slic3r::Vec3d point_on_plane_transformed = trafo_inv * point_on_plane;
            Slic3r::Vec3d normal_transformed = trafo_normal * clp_normal;
            float offset_transformed = float(point_on_plane_transformed.dot(normal_transformed));

            clp = Slic3r::TriangleSelector::ClippingPlane({
                float(normal_transformed.x()),
                float(normal_transformed.y()),
                float(normal_transformed.z()),
                offset_transformed
            });
        }
    }

    struct StrokePoint {
        Slic3r::Vec3f mesh_hit;
        int facet = -1;
    };
    std::vector<StrokePoint> stroke_points;
    int orig_facets = static_cast<int>(vol->mesh().its.indices.size());

    if (args.contains("points") && args["points"].is_array()) {
        for (const auto& pt : args["points"]) {
            StrokePoint sp;
            if (pt.contains("hit") && pt["hit"].is_array() && pt["hit"].size() >= 3) {
                Slic3r::Vec3d world_hit(
                    pt["hit"][0].get<double>(),
                    pt["hit"][1].get<double>(),
                    pt["hit"][2].get<double>()
                );
                sp.mesh_hit = (trafo_matrix.inverse() * world_hit).cast<float>();
            } else {
                throw Slic3r::RuntimeError("Point must have a 3D 'hit' array");
            }
            if (pt.contains("facet") && pt["facet"].is_number_integer()) {
                sp.facet = pt["facet"].get<int>();
            }
            if (sp.facet < 0 || sp.facet >= orig_facets) {
                sp.facet = 0;
            }
            stroke_points.push_back(sp);
        }
    }

    Slic3r::FacetsAnnotation& annotation = get_annotation(*vol, layer);
    float edge_limit = (layer == "color" || layer == "mmu") ? 0.2f : 0.6f;
    Slic3r::TriangleSelector selector(vol->mesh(), edge_limit);
    if (!annotation.empty()) {
        selector.deserialize(annotation.get_data(), false);
    }

    if (!stroke_points.empty()) {
        if (tool == "circle" || tool == "sphere") {
            Slic3r::TriangleSelector::CursorType cursor_type =
                (tool == "sphere") ? Slic3r::TriangleSelector::CursorType::SPHERE
                                   : Slic3r::TriangleSelector::CursorType::CIRCLE;

            if (stroke_points.size() == 1) {
                auto cursor = Slic3r::TriangleSelector::SinglePointCursor::cursor_factory(
                    stroke_points[0].mesh_hit, camera_pos, radius, cursor_type, trafo_matrix, clp);
                selector.select_patch(stroke_points[0].facet, std::move(cursor), new_state,
                    trafo_matrix_not_translate, triangle_splitting, overhang_angle_deg);
            } else {
                for (size_t i = 0; i < stroke_points.size() - 1; ++i) {
                    float dist = (stroke_points[i].mesh_hit - stroke_points[i + 1].mesh_hit).norm();
                    if (dist < 1e-5f) {
                        auto cursor = Slic3r::TriangleSelector::SinglePointCursor::cursor_factory(
                            stroke_points[i].mesh_hit, camera_pos, radius, cursor_type, trafo_matrix, clp);
                        selector.select_patch(stroke_points[i].facet, std::move(cursor), new_state,
                            trafo_matrix_not_translate, triangle_splitting, overhang_angle_deg);
                    } else {
                        auto cursor = Slic3r::TriangleSelector::DoublePointCursor::cursor_factory(
                            stroke_points[i].mesh_hit, stroke_points[i + 1].mesh_hit,
                            camera_pos, radius, cursor_type, trafo_matrix, clp);
                        selector.select_patch(stroke_points[i].facet, std::move(cursor), new_state,
                            trafo_matrix_not_translate, triangle_splitting, overhang_angle_deg);
                    }
                }
            }
        } else if (tool == "smart_fill") {
            for (const auto& sp : stroke_points) {
                selector.seed_fill_unselect_all_triangles();
                selector.seed_fill_select_triangles(sp.mesh_hit, sp.facet, trafo_matrix_not_translate,
                    clp, smart_fill_angle_deg, overhang_angle_deg, true);
                selector.seed_fill_apply_on_triangles(new_state);
            }
        } else if (tool == "bucket") {
            for (const auto& sp : stroke_points) {
                selector.seed_fill_unselect_all_triangles();
                if (bucket_propagate) {
                    selector.bucket_fill_select_triangles(sp.mesh_hit, sp.facet, clp, smart_fill_angle_deg, true, true);
                } else {
                    selector.bucket_fill_select_triangles(sp.mesh_hit, sp.facet, clp, -1.f, false, true);
                }
                selector.seed_fill_apply_on_triangles(new_state);
            }
        } else if (tool == "triangle") {
            for (const auto& sp : stroke_points) {
                selector.seed_fill_unselect_all_triangles();
                selector.bucket_fill_select_triangles(sp.mesh_hit, sp.facet, clp, -1.f, false, true);
                selector.seed_fill_apply_on_triangles(new_state);
            }
        } else if (tool == "height_range") {
            float height = radius;
            if (args.contains("height") && args["height"].is_number()) {
                height = args["height"].get<float>();
            }
            for (const auto& sp : stroke_points) {
                float z_world = float((trafo_matrix * Slic3r::Vec3d(sp.mesh_hit.cast<double>())).z());
                if (args.contains("zWorld") && args["zWorld"].is_number()) {
                    z_world = args["zWorld"].get<float>();
                }
                auto cursor = Slic3r::TriangleSelector::SinglePointCursor::cursor_factory(
                    z_world, camera_pos, height, trafo_matrix, clp);
                selector.select_patch(sp.facet, std::move(cursor), new_state,
                    trafo_matrix_not_translate, triangle_splitting, overhang_angle_deg);
            }
        } else {
            throw Slic3r::RuntimeError("Unknown paint tool: " + tool);
        }
    }

    bool changed = annotation.set(selector);
    json stats = compute_layer_stats(selector, layer);

    return json{
        {"changed", changed},
        {"stats", stats}
    };
}

json getPaintOverlay(const Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("getPaintOverlay requires objectId");
    }
    size_t object_id = args["objectId"].get<size_t>();
    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    const Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }

    if (!args.contains("layer") || !args["layer"].is_string()) {
        throw Slic3r::RuntimeError("getPaintOverlay requires layer");
    }
    std::string layer = args["layer"].get<std::string>();

    const Slic3r::FacetsAnnotation& annotation = get_annotation(*vol, layer);

    struct StateOverlay {
        std::string state_name;
        uint32_t first_triangle;
        uint32_t triangle_count;
    };
    std::vector<StateOverlay> states_meta;
    std::vector<float> all_vertex_coords;
    std::vector<uint32_t> all_indices;
    uint32_t current_triangle = 0;

    if (!annotation.empty()) {
        float edge_limit = (layer == "color" || layer == "mmu") ? 0.2f : 0.6f;
        Slic3r::TriangleSelector selector(vol->mesh(), edge_limit);
        selector.deserialize(annotation.get_data(), false);

        std::vector<Slic3r::EnforcerBlockerType> states_to_check = get_layer_states(layer);
        for (Slic3r::EnforcerBlockerType s : states_to_check) {
            indexed_triangle_set its = selector.get_facets(s);
            if (its.indices.empty())
                continue;

            uint32_t base_vertex = static_cast<uint32_t>(all_vertex_coords.size() / 3);
            for (const auto& v : its.vertices) {
                all_vertex_coords.push_back(v.x());
                all_vertex_coords.push_back(v.y());
                all_vertex_coords.push_back(v.z());
            }

            uint32_t tri_count = static_cast<uint32_t>(its.indices.size());
            states_meta.push_back({
                state_to_string(layer, s),
                current_triangle,
                tri_count
            });

            for (const auto& tri : its.indices) {
                all_indices.push_back(base_vertex + static_cast<uint32_t>(tri(0)));
                all_indices.push_back(base_vertex + static_cast<uint32_t>(tri(1)));
                all_indices.push_back(base_vertex + static_cast<uint32_t>(tri(2)));
            }
            current_triangle += tri_count;
        }
    }

    std::string out_dir = "/out";
    std::filesystem::create_directories(out_dir);
    std::string out_path = out_dir + "/paint_" + std::to_string(obj->id().id) + "_" +
                           std::to_string(vol->id().id) + "_" + layer + ".bin";

    std::ofstream os(out_path, std::ios::binary);
    if (!os.is_open()) {
        throw Slic3r::RuntimeError("Failed to open file for writing: " + out_path);
    }

    os.write("PNT1", 4);
    uint32_t vertex_count = static_cast<uint32_t>(all_vertex_coords.size() / 3);
    uint32_t total_triangles = current_triangle;
    os.write(reinterpret_cast<const char*>(&vertex_count), sizeof(uint32_t));
    os.write(reinterpret_cast<const char*>(&total_triangles), sizeof(uint32_t));

    if (vertex_count > 0) {
        os.write(reinterpret_cast<const char*>(all_vertex_coords.data()), all_vertex_coords.size() * sizeof(float));
    }
    if (total_triangles > 0) {
        os.write(reinterpret_cast<const char*>(all_indices.data()), all_indices.size() * sizeof(uint32_t));
    }
    os.close();

    json states_json = json::array();
    for (const auto& sm : states_meta) {
        states_json.push_back({
            {"state", sm.state_name},
            {"firstTriangle", sm.first_triangle},
            {"triangleCount", sm.triangle_count}
        });
    }

    return json{
        {"path", out_path},
        {"states", states_json}
    };
}

json getPaintData(const Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("getPaintData requires objectId");
    }
    size_t object_id = args["objectId"].get<size_t>();
    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    const Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }

    if (!args.contains("layer") || !args["layer"].is_string()) {
        throw Slic3r::RuntimeError("getPaintData requires layer");
    }
    std::string layer = args["layer"].get<std::string>();

    const Slic3r::FacetsAnnotation& annotation = get_annotation(*vol, layer);
    std::string b64 = serialize_splitting_data_base64(annotation.get_data());

    return json{
        {"data", b64}
    };
}

json setPaintData(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("setPaintData requires objectId");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Cannot set paint data on non-model-part volume");
    }

    if (!args.contains("layer") || !args["layer"].is_string()) {
        throw Slic3r::RuntimeError("setPaintData requires layer");
    }
    std::string layer = args["layer"].get<std::string>();

    if (!args.contains("data") || !args["data"].is_string()) {
        throw Slic3r::RuntimeError("setPaintData requires string 'data'");
    }

    auto splitting_data = deserialize_splitting_data_base64(args["data"].get<std::string>());
    Slic3r::FacetsAnnotation& annotation = get_annotation(*vol, layer);
    annotation.set_data(std::move(splitting_data));

    return json{
        {"restored", true},
        {"updated", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"layer", layer}
    };
}

json clearPaint(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("clearPaint requires objectId");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Cannot clear paint on non-model-part volume");
    }

    if (!args.contains("layer") || !args["layer"].is_string()) {
        throw Slic3r::RuntimeError("clearPaint requires layer");
    }
    std::string layer = args["layer"].get<std::string>();

    Slic3r::FacetsAnnotation& annotation = get_annotation(*vol, layer);

    if (!args.contains("state") || args["state"].is_null()) {
        // Clear entire layer
        annotation.reset();
    } else {
        // Clear specific state
        Slic3r::EnforcerBlockerType target_state = parse_state(layer, args["state"]);
        if (!annotation.empty()) {
            float edge_limit = (layer == "color" || layer == "mmu") ? 0.2f : 0.6f;
            Slic3r::TriangleSelector selector(vol->mesh(), edge_limit);
            selector.deserialize(annotation.get_data(), false);

            Slic3r::EnforcerBlockerStateMap state_map;
            for (size_t i = 0; i < state_map.size(); ++i) {
                state_map[i] = static_cast<Slic3r::EnforcerBlockerType>(i);
            }
            state_map[static_cast<size_t>(target_state)] = Slic3r::EnforcerBlockerType::NONE;
            selector.remap_triangle_state(state_map);
            selector.garbage_collect();

            bool any_painted = false;
            for (size_t s = 1; s <= static_cast<size_t>(Slic3r::EnforcerBlockerType::ExtruderMax); ++s) {
                if (selector.has_facets(static_cast<Slic3r::EnforcerBlockerType>(s))) {
                    any_painted = true;
                    break;
                }
            }
            if (any_painted) {
                annotation.set(selector);
            } else {
                annotation.reset();
            }
        }
    }

    return json{
        {"cleared", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"layer", layer}
    };
}

} // namespace OrcaWasm
