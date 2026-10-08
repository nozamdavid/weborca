#include "ObjectOps.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Utils.hpp"

#include <cmath>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

std::string volume_type_to_string(Slic3r::ModelVolumeType type) {
    switch (type) {
    case Slic3r::ModelVolumeType::MODEL_PART:
        return "part";
    case Slic3r::ModelVolumeType::NEGATIVE_VOLUME:
        return "negative";
    case Slic3r::ModelVolumeType::PARAMETER_MODIFIER:
        return "modifier";
    case Slic3r::ModelVolumeType::SUPPORT_BLOCKER:
        return "support_blocker";
    case Slic3r::ModelVolumeType::SUPPORT_ENFORCER:
        return "support_enforcer";
    default:
        return "part";
    }
}

Slic3r::ModelVolumeType string_to_volume_type(const std::string& str) {
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
    throw Slic3r::RuntimeError("Unknown volume type: " + str);
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

} // namespace

json getObjectTree(const Slic3r::Model& model, const json& /*args*/) {
    json objects_arr = json::array();
    for (const auto* obj : model.objects) {
        if (!obj) continue;

        json instances_arr = json::array();
        for (const auto* inst : obj->instances) {
            if (!inst) continue;
            instances_arr.push_back({
                {"id", inst->id().id}
            });
        }

        json volumes_arr = json::array();
        for (const auto* vol : obj->volumes) {
            if (!vol) continue;

            json vol_cfg = json::object();
            json vol_overrides = json::array();
            for (const std::string& key : vol->config.keys()) {
                vol_cfg[key] = vol->config.opt_serialize(key);
                vol_overrides.push_back(key);
            }

            int extruder_id = vol->config.has("extruder") ? vol->config.extruder() : 0;

            volumes_arr.push_back({
                {"id", vol->id().id},
                {"name", vol->name},
                {"type", volume_type_to_string(vol->type())},
                {"extruder", extruder_id},
                {"config", vol_cfg},
                {"overrides", vol_overrides}
            });
        }

        json layer_ranges_arr = json::array();
        for (const auto& [range, cfg] : obj->layer_config_ranges) {
            json range_cfg = json::object();
            json range_overrides = json::array();
            for (const std::string& key : cfg.keys()) {
                range_cfg[key] = cfg.opt_serialize(key);
                range_overrides.push_back(key);
            }
            layer_ranges_arr.push_back({
                {"minZ", range.first},
                {"maxZ", range.second},
                {"config", range_cfg},
                {"overrides", range_overrides}
            });
        }

        json obj_cfg = json::object();
        json obj_overrides = json::array();
        for (const std::string& key : obj->config.keys()) {
            obj_cfg[key] = obj->config.opt_serialize(key);
            obj_overrides.push_back(key);
        }

        objects_arr.push_back({
            {"id", obj->id().id},
            {"name", obj->name},
            {"instances", instances_arr},
            {"volumes", volumes_arr},
            {"layerRanges", layer_ranges_arr},
            {"config", obj_cfg},
            {"overrides", obj_overrides}
        });
    }

    return json{{"objects", objects_arr}};
}

json addVolume(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    std::string type_str = args.at("type").get<std::string>();
    Slic3r::ModelVolumeType mv_type = string_to_volume_type(type_str);

    std::string shape = args.at("shape").get<std::string>();

    double sx = 20.0, sy = 20.0, sz = 20.0;
    if (args.contains("size")) {
        const auto& s = args["size"];
        if (s.is_number()) {
            sx = sy = sz = s.get<double>();
        } else if (s.is_array()) {
            if (s.size() == 1) {
                sx = sy = sz = s[0].get<double>();
            } else if (s.size() >= 3) {
                sx = s[0].get<double>();
                sy = s[1].get<double>();
                sz = s[2].get<double>();
            }
        } else if (s.is_object()) {
            sx = s.value("x", sx);
            sy = s.value("y", sy);
            sz = s.value("z", sz);
        }
    }

    Slic3r::TriangleMesh mesh;
    std::string default_name;
    if (shape == "cube" || shape == "Cube") {
        mesh = Slic3r::make_cube(sx, sy, sz);
        default_name = "Cube";
    } else if (shape == "cylinder" || shape == "Cylinder") {
        mesh = Slic3r::make_cylinder(0.5 * sx, sz);
        default_name = "Cylinder";
    } else if (shape == "sphere" || shape == "Sphere") {
        mesh = Slic3r::make_sphere(0.5 * sx, 2.0 * M_PI / 90.0);
        default_name = "Sphere";
    } else if (shape == "cone" || shape == "Cone") {
        mesh = Slic3r::make_cone(0.5 * sx, sz);
        default_name = "Cone";
    } else {
        throw Slic3r::RuntimeError("Unknown shape: " + shape);
    }

    // Add volume - centers the geometry in the volume's local frame
    Slic3r::ModelVolume* new_vol = obj->add_volume(std::move(mesh), mv_type);
    new_vol->name = args.value("name", default_name);

    if (args.contains("offset") && args["offset"].is_array() && args["offset"].size() >= 3) {
        new_vol->set_offset(Slic3r::Vec3d(
            args["offset"][0].get<double>(),
            args["offset"][1].get<double>(),
            args["offset"][2].get<double>()
        ));
    } else {
        // Default placement is at (0, 0, 0) in object coordinates,
        // which coincides with the center of the centered model object.
        new_vol->set_offset(Slic3r::Vec3d(0.0, 0.0, 0.0));
    }

    return json{
        {"volumeId", new_vol->id().id},
        {"id", new_vol->id().id},
        {"name", new_vol->name}
    };
}

json deleteVolume(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    int vol_idx = -1;
    for (size_t i = 0; i < obj->volumes.size(); ++i) {
        if (obj->volumes[i] && obj->volumes[i]->id().id == volume_id) {
            vol_idx = static_cast<int>(i);
            break;
        }
    }
    if (vol_idx < 0) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    obj->delete_volume(static_cast<size_t>(vol_idx));
    return json::object();
}

json renameObject(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    std::string name = args.at("name").get<std::string>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    obj->name = name;
    return json::object();
}

json renameVolume(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();
    std::string name = args.at("name").get<std::string>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    vol->name = name;
    return json::object();
}

json setObjectConfig(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    bool is_part = args.contains("volumeId") && !args["volumeId"].is_null();
    Slic3r::ModelVolume* vol = nullptr;
    if (is_part) {
        size_t volume_id = args["volumeId"].get<size_t>();
        vol = find_volume(obj, volume_id);
        if (!vol) {
            throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
        }
    }

    Slic3r::ModelConfig& target_config = is_part ? vol->config : obj->config;

    static const Slic3r::PrintRegionConfig s_reg_config;
    static const Slic3r::PrintObjectConfig s_obj_config;

    json errors_arr = json::array();
    if (args.contains("options") && args["options"].is_object()) {
        for (auto& [key, val] : args["options"].items()) {
            if (!Slic3r::print_config_def.has(key)) {
                errors_arr.push_back({{"key", key}, {"error", "Unknown option key"}});
                continue;
            }

            // Allowed scope check
            // Desktop rule (GUI_Factories.cpp:194):
            // Part/modifier/range scope allows only PrintRegionConfig options.
            // Object scope allows PrintObjectConfig + PrintRegionConfig options.
            if (is_part) {
                if (!s_reg_config.has(key)) {
                    errors_arr.push_back({{"key", key}, {"error", "Option not allowed for volume/part scope"}});
                    continue;
                }
            } else {
                if (!s_reg_config.has(key) && !s_obj_config.has(key)) {
                    errors_arr.push_back({{"key", key}, {"error", "Option not allowed for object scope"}});
                    continue;
                }
            }

            std::string sval;
            if (val.is_string()) {
                sval = val.get<std::string>();
            } else if (val.is_number_float()) {
                sval = Slic3r::float_to_string_decimal_point(val.get<double>());
            } else if (val.is_number()) {
                sval = val.dump();
            } else if (val.is_boolean()) {
                sval = val.get<bool>() ? "1" : "0";
            } else if (val.is_array()) {
                const Slic3r::ConfigOptionDef* optdef = Slic3r::print_config_def.get(key);
                char sep = (optdef && optdef->type == Slic3r::coStrings) ? ';' : ',';
                std::string joined;
                for (size_t i = 0; i < val.size(); ++i) {
                    if (i > 0) joined += sep;
                    if (val[i].is_string()) joined += val[i].get<std::string>();
                    else joined += val[i].dump();
                }
                sval = joined;
            } else {
                errors_arr.push_back({{"key", key}, {"error", "Unsupported value type"}});
                continue;
            }

            try {
                Slic3r::DynamicPrintConfig tmp;
                tmp.set_deserialize_strict(key, sval);
                target_config.apply(tmp);
            } catch (const std::exception& e) {
                errors_arr.push_back({{"key", key}, {"error", e.what()}});
            }
        }
    }

    return json{{"errors", errors_arr}};
}

json resetObjectConfig(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    bool is_part = args.contains("volumeId") && !args["volumeId"].is_null();
    Slic3r::ModelVolume* vol = nullptr;
    if (is_part) {
        size_t volume_id = args["volumeId"].get<size_t>();
        vol = find_volume(obj, volume_id);
        if (!vol) {
            throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
        }
    }

    Slic3r::ModelConfig& target_config = is_part ? vol->config : obj->config;

    if (args.contains("keys") && args["keys"].is_array() && !args["keys"].empty()) {
        for (const auto& k : args["keys"]) {
            target_config.erase(k.get<std::string>());
        }
    } else {
        target_config.reset();
    }

    return json::object();
}

json setVolumeExtruder(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();
    int extruder = args.at("extruder").get<int>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    if (extruder > 0) {
        if (vol->config.has("extruder")) {
            vol->config.set("extruder", extruder);
        } else {
            vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(extruder));
        }
    } else {
        vol->config.erase("extruder");
    }

    return json::object();
}

} // namespace OrcaWasm
