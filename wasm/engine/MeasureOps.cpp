#include "MeasureOps.hpp"

#include "libslic3r/Measure.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/TriangleMesh.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

using namespace Slic3r;
using namespace Slic3r::Measure;

// Find object in model by integer id
ModelObject* find_object(Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

ModelInstance* find_instance(ModelObject* obj, size_t instance_id) {
    if (!obj) return nullptr;
    for (auto* inst : obj->instances) {
        if (inst && inst->id().id == instance_id)
            return inst;
    }
    return nullptr;
}

ModelVolume* find_volume(ModelObject* obj, size_t volume_id) {
    if (!obj) return nullptr;
    for (auto* vol : obj->volumes) {
        if (vol && vol->id().id == volume_id)
            return vol;
    }
    return nullptr;
}

bool parse_vec3(const json& j, Vec3d& out) {
    if (j.is_array() && j.size() >= 3) {
        if (!j[0].is_number() || !j[1].is_number() || !j[2].is_number()) return false;
        double x = j[0].get<double>();
        double y = j[1].get<double>();
        double z = j[2].get<double>();
        if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return false;
        out = Vec3d(x, y, z);
        return true;
    }
    if (j.is_object() && j.contains("x") && j.contains("y") && j.contains("z")) {
        if (!j["x"].is_number() || !j["y"].is_number() || !j["z"].is_number()) return false;
        double x = j["x"].get<double>();
        double y = j["y"].get<double>();
        double z = j["z"].get<double>();
        if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return false;
        out = Vec3d(x, y, z);
        return true;
    }
    return false;
}

json serialize_surface_feature(const SurfaceFeature& feature, Measuring* measuring = nullptr, bool include_plane_features = true) {
    json j = json::object();
    switch (feature.get_type()) {
    case SurfaceFeatureType::Point: {
        Vec3d pt = feature.get_point();
        j["type"] = "point";
        j["point"] = {pt.x(), pt.y(), pt.z()};
        j["raw"] = {
            {"type", static_cast<int>(SurfaceFeatureType::Point)},
            {"pt1", {pt.x(), pt.y(), pt.z()}},
            {"pt2", {0.0, 0.0, 0.0}},
            {"pt3", nullptr},
            {"value", 0.0}
        };
        break;
    }
    case SurfaceFeatureType::Edge: {
        const auto& [sp, ep] = feature.get_edge();
        double length = (ep - sp).norm();
        j["type"] = "edge";
        j["edge"] = {
            {"start", {sp.x(), sp.y(), sp.z()}},
            {"end", {ep.x(), ep.y(), ep.z()}},
            {"length", length}
        };
        auto extra = feature.get_extra_point();
        json extra_j = nullptr;
        if (extra.has_value()) {
            extra_j = {extra->x(), extra->y(), extra->z()};
            j["extraPoint"] = extra_j;
        }
        j["raw"] = {
            {"type", static_cast<int>(SurfaceFeatureType::Edge)},
            {"pt1", {sp.x(), sp.y(), sp.z()}},
            {"pt2", {ep.x(), ep.y(), ep.z()}},
            {"pt3", extra_j},
            {"value", 0.0}
        };
        break;
    }
    case SurfaceFeatureType::Circle: {
        const auto& [center, radius, normal] = feature.get_circle();
        j["type"] = "circle";
        j["circle"] = {
            {"center", {center.x(), center.y(), center.z()}},
            {"normal", {normal.x(), normal.y(), normal.z()}},
            {"radius", radius},
            {"diameter", 2.0 * radius}
        };
        j["raw"] = {
            {"type", static_cast<int>(SurfaceFeatureType::Circle)},
            {"pt1", {center.x(), center.y(), center.z()}},
            {"pt2", {normal.x(), normal.y(), normal.z()}},
            {"pt3", nullptr},
            {"value", radius}
        };
        break;
    }
    case SurfaceFeatureType::Plane: {
        const auto& [idx, normal, origin] = feature.get_plane();
        j["type"] = "plane";
        json boundary_features = json::array();

        if (include_plane_features) {
            if (feature.world_plane_features) {
                for (const auto& sf : *feature.world_plane_features) {
                    boundary_features.push_back(serialize_surface_feature(sf, nullptr, false));
                }
            } else if (measuring && idx >= 0 && idx < measuring->get_num_of_planes()) {
                const auto& cur_plane_features = measuring->get_plane_features(static_cast<unsigned int>(idx));
                for (const auto& sf : cur_plane_features) {
                    boundary_features.push_back(serialize_surface_feature(sf, nullptr, false));
                }
            }
        }

        j["plane"] = {
            {"normal", {normal.x(), normal.y(), normal.z()}},
            {"origin", {origin.x(), origin.y(), origin.z()}},
            {"planeIndex", idx},
            {"features", boundary_features}
        };
        j["raw"] = {
            {"type", static_cast<int>(SurfaceFeatureType::Plane)},
            {"pt1", {normal.x(), normal.y(), normal.z()}},
            {"pt2", {origin.x(), origin.y(), origin.z()}},
            {"pt3", nullptr},
            {"value", static_cast<double>(idx)}
        };
        break;
    }
    default:
        j["type"] = "undef";
        break;
    }
    return j;
}

SurfaceFeature deserialize_surface_feature(const json& j) {
    if (!j.is_object()) {
        return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
    }

    // If raw is present, strictly validate and reconstruct without defaulting missing fields
    if (j.contains("raw") && j["raw"].is_object()) {
        const auto& raw = j["raw"];
        if (!raw.contains("type") || !raw["type"].is_number_integer()) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        int type_int = raw["type"].get<int>();
        if (type_int != 1 && type_int != 2 && type_int != 4 && type_int != 8) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }

        if (!raw.contains("pt1")) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        Vec3d pt1 = Vec3d::Zero();
        if (!parse_vec3(raw["pt1"], pt1)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }

        Vec3d pt2 = Vec3d::Zero();
        SurfaceFeatureType sft = static_cast<SurfaceFeatureType>(type_int);
        if (sft != SurfaceFeatureType::Point) {
            if (!raw.contains("pt2") || !parse_vec3(raw["pt2"], pt2)) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
        }

        std::optional<Vec3d> pt3 = std::nullopt;
        if (raw.contains("pt3") && !raw["pt3"].is_null()) {
            Vec3d p3;
            if (parse_vec3(raw["pt3"], p3)) pt3 = p3;
            else return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }

        double val = 0.0;
        if (raw.contains("value")) {
            if (!raw["value"].is_number()) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
            val = raw["value"].get<double>();
            if (!std::isfinite(val)) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
        }

        if (sft == SurfaceFeatureType::Edge) {
            if ((pt2 - pt1).norm() < 1e-6) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
        } else if (sft == SurfaceFeatureType::Circle) {
            if (pt2.norm() < 1e-6 || val <= 1e-6) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
            pt2.normalize();
        } else if (sft == SurfaceFeatureType::Plane) {
            if (pt1.norm() < 1e-6 || val < 0.0) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
            pt1.normalize();
        }

        SurfaceFeature sf(sft, pt1, pt2, pt3, val);
        sf.origin_surface_feature = std::make_shared<SurfaceFeature>(sf);

        if (sf.get_type() == SurfaceFeatureType::Plane && j.contains("plane") && j["plane"].contains("features")) {
            const auto& feats = j["plane"]["features"];
            if (feats.is_array()) {
                auto boundary = std::make_shared<std::vector<SurfaceFeature>>();
                for (const auto& bf : feats) {
                    auto parsed_bf = deserialize_surface_feature(bf);
                    if (parsed_bf.get_type() != SurfaceFeatureType::Undef) {
                        boundary->push_back(parsed_bf);
                    }
                }
                sf.world_plane_features = boundary;
            }
        }
        return sf;
    }

    if (!j.contains("type") || !j["type"].is_string()) {
        return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
    }

    std::string type_str = j["type"].get<std::string>();
    if (type_str == "point") {
        if (!j.contains("point")) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        Vec3d pt = Vec3d::Zero();
        if (!parse_vec3(j["point"], pt)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        SurfaceFeature sf(pt);
        sf.origin_surface_feature = std::make_shared<SurfaceFeature>(sf);
        return sf;
    }
    if (type_str == "edge") {
        if (!j.contains("edge") || !j["edge"].is_object()) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        const auto& e = j["edge"];
        if (!e.contains("start") || !e.contains("end")) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        Vec3d sp = Vec3d::Zero();
        Vec3d ep = Vec3d::Zero();
        if (!parse_vec3(e["start"], sp) || !parse_vec3(e["end"], ep)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        if ((ep - sp).norm() < 1e-6) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        std::optional<Vec3d> pt3 = std::nullopt;
        if (j.contains("extraPoint") && !j["extraPoint"].is_null()) {
            Vec3d p3;
            if (parse_vec3(j["extraPoint"], p3)) pt3 = p3;
            else return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        SurfaceFeature sf(SurfaceFeatureType::Edge, sp, ep, pt3, 0.0);
        sf.origin_surface_feature = std::make_shared<SurfaceFeature>(sf);
        return sf;
    }
    if (type_str == "circle") {
        if (!j.contains("circle") || !j["circle"].is_object()) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        const auto& c = j["circle"];
        if (!c.contains("center") || !c.contains("normal") || !c.contains("radius")) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        Vec3d center = Vec3d::Zero();
        Vec3d normal = Vec3d::UnitZ();
        if (!parse_vec3(c["center"], center) || !parse_vec3(c["normal"], normal)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        if (normal.norm() < 1e-6) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        normal.normalize();
        if (!c["radius"].is_number()) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        double r = c["radius"].get<double>();
        if (r <= 1e-6 || !std::isfinite(r)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        SurfaceFeature sf(SurfaceFeatureType::Circle, center, normal, std::nullopt, r);
        sf.origin_surface_feature = std::make_shared<SurfaceFeature>(sf);
        return sf;
    }
    if (type_str == "plane") {
        if (!j.contains("plane") || !j["plane"].is_object()) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        const auto& p = j["plane"];
        if (!p.contains("normal") || !p.contains("origin")) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        Vec3d normal = Vec3d::UnitZ();
        Vec3d origin = Vec3d::Zero();
        if (!parse_vec3(p["normal"], normal) || !parse_vec3(p["origin"], origin)) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        if (normal.norm() < 1e-6) {
            return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
        }
        normal.normalize();
        double idx = 0.0;
        if (p.contains("planeIndex")) {
            if (!p["planeIndex"].is_number()) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
            idx = p["planeIndex"].get<double>();
            if (!std::isfinite(idx) || idx < 0.0) {
                return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
            }
        }
        SurfaceFeature sf(SurfaceFeatureType::Plane, normal, origin, std::nullopt, idx);
        sf.origin_surface_feature = std::make_shared<SurfaceFeature>(sf);
        if (p.contains("features") && p["features"].is_array()) {
            auto boundary = std::make_shared<std::vector<SurfaceFeature>>();
            for (const auto& bf : p["features"]) {
                auto parsed_bf = deserialize_surface_feature(bf);
                if (parsed_bf.get_type() != SurfaceFeatureType::Undef) {
                    boundary->push_back(parsed_bf);
                }
            }
            sf.world_plane_features = boundary;
        }
        return sf;
    }

    // Malformed, unsupported, or 'undef' feature
    return SurfaceFeature(SurfaceFeatureType::Undef, Vec3d::Zero(), Vec3d::Zero());
}

} // namespace

json getMeasurementFeature(Model& model, const json& args) {
    try {
        if (!args.is_object()) {
            return {{"success", false}, {"error", "Arguments must be an object"}};
        }

        if (!args.contains("objectId")) {
            return {{"success", false}, {"error", "Missing objectId"}};
        }
        size_t object_id = args["objectId"].get<size_t>();
        ModelObject* obj = find_object(model, object_id);
        if (!obj) {
            return {{"success", false}, {"error", "Object not found"}};
        }

        ModelInstance* inst = nullptr;
        if (args.contains("instanceId")) {
            size_t inst_id = args["instanceId"].get<size_t>();
            inst = find_instance(obj, inst_id);
        } else if (!obj->instances.empty()) {
            inst = obj->instances[0];
        }
        if (!inst) {
            return {{"success", false}, {"error", "Instance not found"}};
        }

        ModelVolume* vol = nullptr;
        if (args.contains("volumeId")) {
            size_t vol_id = args["volumeId"].get<size_t>();
            vol = find_volume(obj, vol_id);
        } else if (!obj->volumes.empty()) {
            vol = obj->volumes[0];
        }
        if (!vol) {
            return {{"success", false}, {"error", "Volume not found"}};
        }

        const auto& its = vol->mesh().its;
        if (its.indices.empty()) {
            return {{"success", false}, {"error", "Volume mesh is empty"}};
        }

        if (!args.contains("facetIndex") || !args["facetIndex"].is_number_integer()) {
            return {{"success", false}, {"error", "Missing or invalid facetIndex"}};
        }
        int facet_idx_raw = args["facetIndex"].get<int>();
        if (facet_idx_raw < 0 || static_cast<size_t>(facet_idx_raw) >= its.indices.size()) {
            return {{"success", false}, {"error", "facetIndex out of range"}};
        }
        size_t facet_index = static_cast<size_t>(facet_idx_raw);

        Vec3d world_pos = Vec3d::Zero();
        if (!args.contains("position") || !parse_vec3(args["position"], world_pos)) {
            return {{"success", false}, {"error", "Missing or invalid position (must be 3D coordinates)"}};
        }

        if (args.contains("selection") && !args["selection"].is_string()) {
            return {{"success", false}, {"error", "selection must be a string"}};
        }
        std::string selection = args.value("selection", "auto");
        if (selection != "auto" && selection != "plane" && selection != "edge" && selection != "circle" && selection != "point") {
            return {{"success", false}, {"error", "Unknown selection mode: " + selection}};
        }

        Transform3d world_matrix = inst->get_matrix() * vol->get_matrix();

        // Build world-transformed ITS for scoped per-call Measuring
        indexed_triangle_set its_world = its;
        its_transform(its_world, world_matrix, true);

        Measuring measuring(its_world);

        if (selection == "point") {
            SurfaceFeature point_sf(world_pos);
            point_sf.origin_surface_feature = std::make_shared<SurfaceFeature>(point_sf);
            return {
                {"success", true},
                {"feature", serialize_surface_feature(point_sf, &measuring)}
            };
        }

        bool only_select_plane = (selection == "plane");
        auto feature_opt = measuring.get_feature(facet_index, world_pos, Transform3d::Identity(), only_select_plane);

        if (!feature_opt.has_value()) {
            return {{"success", false}, {"error", "No feature detected on facet"}};
        }

        if (selection == "plane") {
            if (feature_opt->get_type() == SurfaceFeatureType::Plane) {
                const auto& [idx, normal, origin] = feature_opt->get_plane();
                if (idx >= 0 && idx < measuring.get_num_of_planes()) {
                    const auto& plane_feats = measuring.get_plane_features(static_cast<unsigned int>(idx));
                    feature_opt->world_plane_features = std::make_shared<std::vector<SurfaceFeature>>(plane_feats);
                }
            }
            return {
                {"success", true},
                {"feature", serialize_surface_feature(*feature_opt, &measuring)}
            };
        }

        if (selection == "circle") {
            if (feature_opt->get_type() == SurfaceFeatureType::Circle) {
                return {
                    {"success", true},
                    {"feature", serialize_surface_feature(*feature_opt, &measuring)}
                };
            }
            // Search plane features for circle
            auto plane_feat = measuring.get_feature(facet_index, world_pos, Transform3d::Identity(), true);
            if (plane_feat.has_value() && plane_feat->get_type() == SurfaceFeatureType::Plane) {
                const auto& [idx, normal, origin] = plane_feat->get_plane();
                if (idx >= 0 && idx < measuring.get_num_of_planes()) {
                    const auto& feats = measuring.get_plane_features(static_cast<unsigned int>(idx));
                    double min_dist = std::numeric_limits<double>::max();
                    const SurfaceFeature* best_circle = nullptr;
                    SurfaceFeature pos_sf(world_pos);
                    for (const auto& f : feats) {
                        if (f.get_type() == SurfaceFeatureType::Circle) {
                            auto m = get_measurement(f, pos_sf);
                            if (m.distance_strict.has_value() && m.distance_strict->dist < min_dist) {
                                min_dist = m.distance_strict->dist;
                                best_circle = &f;
                            }
                        }
                    }
                    if (best_circle) {
                        return {
                            {"success", true},
                            {"feature", serialize_surface_feature(*best_circle, &measuring)}
                        };
                    }
                }
            }
            return {{"success", false}, {"error", "No circular feature detected on selected face"}};
        }

        if (selection == "edge") {
            if (feature_opt->get_type() == SurfaceFeatureType::Edge) {
                return {
                    {"success", true},
                    {"feature", serialize_surface_feature(*feature_opt, &measuring)}
                };
            }
            auto plane_feat = measuring.get_feature(facet_index, world_pos, Transform3d::Identity(), true);
            if (plane_feat.has_value() && plane_feat->get_type() == SurfaceFeatureType::Plane) {
                const auto& [idx, normal, origin] = plane_feat->get_plane();
                if (idx >= 0 && idx < measuring.get_num_of_planes()) {
                    const auto& feats = measuring.get_plane_features(static_cast<unsigned int>(idx));
                    double min_dist = std::numeric_limits<double>::max();
                    const SurfaceFeature* best_edge = nullptr;
                    SurfaceFeature pos_sf(world_pos);
                    for (const auto& f : feats) {
                        if (f.get_type() == SurfaceFeatureType::Edge) {
                            auto m = get_measurement(f, pos_sf);
                            if (m.distance_strict.has_value() && m.distance_strict->dist < min_dist) {
                                min_dist = m.distance_strict->dist;
                                best_edge = &f;
                            }
                        }
                    }
                    if (best_edge) {
                        return {
                            {"success", true},
                            {"feature", serialize_surface_feature(*best_edge, &measuring)}
                        };
                    }
                }
            }
            return {{"success", false}, {"error", "No edge feature detected on selected face"}};
        }

        // "auto" mode:
        if (feature_opt->get_type() == SurfaceFeatureType::Plane) {
            const auto& [idx, normal, origin] = feature_opt->get_plane();
            if (idx >= 0 && idx < measuring.get_num_of_planes()) {
                const auto& plane_feats = measuring.get_plane_features(static_cast<unsigned int>(idx));
                feature_opt->world_plane_features = std::make_shared<std::vector<SurfaceFeature>>(plane_feats);
            }
        }

        return {
            {"success", true},
            {"feature", serialize_surface_feature(*feature_opt, &measuring)}
        };

    } catch (const std::exception& e) {
        return {{"success", false}, {"error", e.what()}};
    } catch (...) {
        return {{"success", false}, {"error", "Unknown error in getMeasurementFeature"}};
    }
}

json measureFeatures(const json& args) {
    try {
        if (!args.is_object()) {
            return {{"success", false}, {"error", "Arguments must be an object"}};
        }

        json feat1_json = nullptr;
        if (args.contains("first")) feat1_json = args["first"];
        else if (args.contains("feature1")) feat1_json = args["feature1"];

        if (feat1_json.is_null() || !feat1_json.is_object()) {
            return {{"success", false}, {"error", "Missing first feature"}};
        }

        SurfaceFeature f1 = deserialize_surface_feature(feat1_json);
        if (f1.get_type() == SurfaceFeatureType::Undef) {
            return {{"success", false}, {"error", "Invalid or malformed first feature"}};
        }

        json feat2_json = nullptr;
        if (args.contains("second") && !args["second"].is_null()) feat2_json = args["second"];
        else if (args.contains("feature2") && !args["feature2"].is_null()) feat2_json = args["feature2"];

        // Single feature measurement
        if (feat2_json.is_null()) {
            json out = json::object();
            out["success"] = true;
            out["hasAnyData"] = true;
            out["distanceStrict"] = nullptr;
            out["distanceInfinite"] = nullptr;
            out["distance"] = nullptr;
            out["distanceType"] = nullptr;
            out["angle"] = nullptr;
            out["distanceXyz"] = nullptr;
            out["delta"] = nullptr;

            switch (f1.get_type()) {
            case SurfaceFeatureType::Circle: {
                auto [center, radius, normal] = f1.get_circle();
                auto res = get_measurement(f1, SurfaceFeature(center));
                double diam = 2.0 * radius;
                out["distance"] = diam;
                out["distanceType"] = "diameter";
                out["radius"] = radius;
                out["diameter"] = diam;
                if (res.distance_strict.has_value()) {
                    out["distanceStrict"] = {
                        {"dist", radius},
                        {"from", {center.x(), center.y(), center.z()}},
                        {"to", {res.distance_strict->to.x(), res.distance_strict->to.y(), res.distance_strict->to.z()}}
                    };
                }
                break;
            }
            case SurfaceFeatureType::Edge: {
                auto [sp, ep] = f1.get_edge();
                double length = (ep - sp).norm();
                out["distance"] = length;
                out["distanceType"] = "length";
                out["length"] = length;
                out["distanceStrict"] = {
                    {"dist", length},
                    {"from", {sp.x(), sp.y(), sp.z()}},
                    {"to", {ep.x(), ep.y(), ep.z()}}
                };
                Vec3d d = ep - sp;
                out["distanceXyz"] = {d.x(), d.y(), d.z()};
                out["delta"] = {std::abs(d.x()), std::abs(d.y()), std::abs(d.z())};
                break;
            }
            case SurfaceFeatureType::Plane: {
                auto [idx, normal, origin] = f1.get_plane();
                out["plane"] = {
                    {"normal", {normal.x(), normal.y(), normal.z()}},
                    {"origin", {origin.x(), origin.y(), origin.z()}}
                };
                break;
            }
            case SurfaceFeatureType::Point: {
                Vec3d pt = f1.get_point();
                out["point"] = {pt.x(), pt.y(), pt.z()};
                break;
            }
            default:
                return {{"success", false}, {"error", "Unsupported feature shape"}};
            }
            return out;
        }

        // Two-feature measurement
        if (!feat2_json.is_object()) {
            return {{"success", false}, {"error", "Invalid or malformed second feature"}};
        }

        SurfaceFeature f2 = deserialize_surface_feature(feat2_json);
        if (f2.get_type() == SurfaceFeatureType::Undef) {
            return {{"success", false}, {"error", "Invalid or malformed second feature"}};
        }

        if (f1.get_type() == SurfaceFeatureType::Undef || f2.get_type() == SurfaceFeatureType::Undef) {
            return {{"success", false}, {"error", "Cannot measure undefined or unsupported feature shape"}};
        }

        MeasurementResult res = get_measurement(f1, f2);

        json out = json::object();
        out["success"] = true;
        out["hasAnyData"] = res.has_any_data();

        if (res.distance_strict.has_value()) {
            out["distanceStrict"] = {
                {"dist", res.distance_strict->dist},
                {"from", {res.distance_strict->from.x(), res.distance_strict->from.y(), res.distance_strict->from.z()}},
                {"to", {res.distance_strict->to.x(), res.distance_strict->to.y(), res.distance_strict->to.z()}}
            };
        } else {
            out["distanceStrict"] = nullptr;
        }

        if (res.distance_infinite.has_value()) {
            out["distanceInfinite"] = {
                {"dist", res.distance_infinite->dist},
                {"from", {res.distance_infinite->from.x(), res.distance_infinite->from.y(), res.distance_infinite->from.z()}},
                {"to", {res.distance_infinite->to.x(), res.distance_infinite->to.y(), res.distance_infinite->to.z()}}
            };
        } else {
            out["distanceInfinite"] = nullptr;
        }

        if (res.distance_strict.has_value()) {
            out["distance"] = res.distance_strict->dist;
            out["distanceType"] = "strict";
        } else if (res.distance_infinite.has_value()) {
            out["distance"] = res.distance_infinite->dist;
            out["distanceType"] = "infinite";
        } else {
            out["distance"] = nullptr;
            out["distanceType"] = nullptr;
        }

        if (res.angle.has_value()) {
            double rad = res.angle->angle;
            double deg = rad * (180.0 / M_PI);
            out["angle"] = {
                {"rad", rad},
                {"deg", deg},
                {"center", {res.angle->center.x(), res.angle->center.y(), res.angle->center.z()}},
                {"radius", res.angle->radius},
                {"coplanar", res.angle->coplanar},
                {"unit", "deg"}
            };
        } else {
            out["angle"] = nullptr;
        }

        // Coordinate deltas
        if (res.distance_xyz.has_value()) {
            out["distanceXyz"] = {res.distance_xyz->x(), res.distance_xyz->y(), res.distance_xyz->z()};
            out["delta"] = {std::abs(res.distance_xyz->x()), std::abs(res.distance_xyz->y()), std::abs(res.distance_xyz->z())};
        } else if (res.distance_strict.has_value()) {
            Vec3d d = res.distance_strict->to - res.distance_strict->from;
            out["distanceXyz"] = {d.x(), d.y(), d.z()};
            out["delta"] = {std::abs(d.x()), std::abs(d.y()), std::abs(d.z())};
        } else if (res.distance_infinite.has_value()) {
            Vec3d d = res.distance_infinite->to - res.distance_infinite->from;
            out["distanceXyz"] = {d.x(), d.y(), d.z()};
            out["delta"] = {std::abs(d.x()), std::abs(d.y()), std::abs(d.z())};
        } else {
            out["distanceXyz"] = nullptr;
            out["delta"] = nullptr;
        }

        return out;

    } catch (const std::exception& e) {
        return {{"success", false}, {"error", e.what()}};
    } catch (...) {
        return {{"success", false}, {"error", "Unknown error in measureFeatures"}};
    }
}

} // namespace OrcaWasm
