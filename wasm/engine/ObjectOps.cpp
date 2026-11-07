#include "ObjectOps.hpp"
#include "PlateOps.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/BoundingBox.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <map>
#include <set>
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
            const Slic3r::Vec3d offset = inst->get_offset();
            instances_arr.push_back({
                {"id", inst->id().id},
                {"offset", {offset.x(), offset.y(), offset.z()}}
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
            if (extruder_id == 0 && obj->config.has("extruder"))
                extruder_id = obj->config.extruder();

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

json getVolume(Slic3r::Model& model, const json& args) {
    for (const char* key : {"objectId", "volumeId"}) {
        const auto& id = args.at(key);
        if (!id.is_number_integer() || (id.is_number_integer() && !id.is_number_unsigned() && id.get<int64_t>() < 0))
            throw Slic3r::RuntimeError(std::string("Invalid ") + key);
    }
    auto* obj = find_object(model, args.at("objectId").get<size_t>());
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    auto* vol = find_volume(obj, args.at("volumeId").get<size_t>());
    if (!vol) throw Slic3r::RuntimeError("Volume not found");
    auto vec = [](const Slic3r::Vec3d& v) { return json::array({v.x(), v.y(), v.z()}); };
    const auto bounds = vol->mesh().bounding_box();
    json local_bounds = nullptr;
    if (bounds.defined)
        local_bounds = {{"min", vec(bounds.min)}, {"max", vec(bounds.max)}};
    return {{"objectId", obj->id().id}, {"volumeId", vol->id().id},
            {"name", vol->name}, {"type", volume_type_to_string(vol->type())},
            {"offset", vec(vol->get_offset())}, {"rotation", vec(vol->get_rotation())},
            {"scale", vec(vol->get_scaling_factor())}, {"mirror", vec(vol->get_mirror())},
            {"localBounds", local_bounds}};
}

json setVolumeTransform(Slic3r::Model& model, const json& args) {
    // Validate every supplied component before touching the model.
    getVolume(model, args);
    auto* obj = find_object(model, args.at("objectId").get<size_t>());
    auto* vol = find_volume(obj, args.at("volumeId").get<size_t>());
    auto transform = vol->get_transformation();
    auto offset = vol->get_offset();
    auto rotation = vol->get_rotation();
    auto scale = vol->get_scaling_factor();
    auto mirror = vol->get_mirror();
    for (const char* key : {"offset", "rotation", "scale", "mirror"}) {
        if (!args.contains(key)) continue;
        const auto& value = args.at(key);
        Slic3r::Vec3d v;
        if (std::string(key) == "scale" && value.is_number())
            v = Slic3r::Vec3d::Constant(value.get<double>());
        else {
            if (!value.is_array() || value.size() != 3)
                throw Slic3r::RuntimeError(std::string(key) + " requires three finite numbers");
            for (size_t i = 0; i < 3; ++i) {
                if (!value[i].is_number()) throw Slic3r::RuntimeError("Invalid transform number");
                v[i] = value[i].get<double>();
            }
        }
        if (!v.allFinite()) throw Slic3r::RuntimeError("Non-finite transform number");
        if (std::string(key) == "offset") offset = v;
        else if (std::string(key) == "rotation") rotation = v;
        else if (std::string(key) == "scale") {
            if ((v.array() <= 0.0).any()) throw Slic3r::RuntimeError("Scale must be positive");
            scale = v;
        } else {
            if ((v.array().abs() != 1.0).any()) throw Slic3r::RuntimeError("Mirror must be -1 or 1");
            mirror = v;
        }
    }
    // Preserve the exact linear matrix for translation-only edits. Assemble all
    // other components together so resetting a mirrored transform is identity.
    if (args.contains("rotation") || args.contains("scale") || args.contains("mirror"))
        transform.set_matrix(Slic3r::Geometry::assemble_transform(offset, rotation, scale, mirror));
    else
        transform.set_offset(offset);
    vol->set_transformation(transform);
    obj->invalidate_bounding_box();
    return getVolume(model, args);
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
    } else if (shape == "disc") {
        mesh = Slic3r::make_cylinder(0.5 * sx, 0.2 * sx);
        default_name = "Disc";
    } else if (shape == "torus") {
        mesh = Slic3r::make_torus(0.5 * sx, 0.125 * sx, M_PI / 60.0);
        default_name = "Torus";
    } else if (shape == "slab") {
        mesh = Slic3r::make_cube(1.5 * sx, 1.5 * sy, 0.5 * sz);
        default_name = "Slab";
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

json deleteInstances(Slic3r::Model& model, const json& args) {
    std::map<size_t, std::set<size_t>> selection;
    for (const auto& ref : args.at("instances")) {
        const auto& object_id = ref.at("objectId");
        const auto& instance_id = ref.at("instanceId");
        if (!object_id.is_number_unsigned() || !instance_id.is_number_unsigned())
            throw Slic3r::RuntimeError("Invalid selected instance ID");
        selection[object_id.get<size_t>()].insert(instance_id.get<size_t>());
    }
    // Validate the complete selection before deleting anything.
    for (const auto& [object_id, instances] : selection) {
        const auto* object = find_object(model, object_id);
        if (!object) throw Slic3r::RuntimeError("Selected object not found");
        for (size_t id : instances)
            if (std::none_of(object->instances.begin(), object->instances.end(),
                             [id](const auto* instance) { return instance->id().id == id; }))
                throw Slic3r::RuntimeError("Selected instance not found");
    }
    for (const auto& [object_id, instances] : selection) {
        auto* object = find_object(model, object_id);
        for (size_t i = object->instances.size(); i-- > 0;)
            if (instances.count(object->instances[i]->id().id)) object->delete_instance(i);
        if (object->instances.empty()) model.delete_object(object);
    }
    return json::object();
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

    // Desktop 3MF stores a single part's assignment on its object.
    auto& config = obj->volumes.size() == 1 ? obj->config : vol->config;
    if (obj->volumes.size() == 1)
        vol->config.erase("extruder");
    if (extruder > 0)
        config.set_key_value("extruder", new Slic3r::ConfigOptionInt(extruder));
    else
        config.erase("extruder");

    return json::object();
}

json moveVolume(Slic3r::Model& model, const json& args) {
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();
    int to_index = args.at("toIndex").get<int>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    auto& volumes = obj->volumes;
    auto it = std::find_if(volumes.begin(), volumes.end(), [&](const Slic3r::ModelVolume* v) {
        return v && v->id().id == volume_id;
    });
    if (it == volumes.end()) {
        throw Slic3r::RuntimeError("Volume not found: " + std::to_string(volume_id));
    }

    Slic3r::ModelVolume* vol = *it;
    volumes.erase(it);
    const size_t target = static_cast<size_t>(std::clamp(to_index, 0, static_cast<int>(volumes.size())));
    volumes.insert(volumes.begin() + target, vol);
    return {{"index", target}};
}

json setVolumeType(Slic3r::Model& model, const json& args) {
    for (const char* key : {"objectId", "volumeId"}) {
        if (!args.contains(key))
            throw Slic3r::RuntimeError(std::string("Missing ") + key);
        const auto& id = args.at(key);
        if (!id.is_number_integer() || (id.is_number_integer() && !id.is_number_unsigned() && id.get<int64_t>() < 0))
            throw Slic3r::RuntimeError(std::string("Invalid ") + key);
    }
    size_t object_id = args.at("objectId").get<size_t>();
    size_t volume_id = args.at("volumeId").get<size_t>();
    if (!args.contains("type") || !args["type"].is_string()) {
        throw Slic3r::RuntimeError("type must be a string");
    }
    std::string type_str = args.at("type").get<std::string>();

    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) throw Slic3r::RuntimeError("Volume not found");

    Slic3r::ModelVolumeType new_type = string_to_volume_type(type_str);

    // Defense-in-depth: SVG / text volumes carry emboss metadata that only makes sense
    // for Part / Negative Part / Modifier.
    if ((new_type == Slic3r::ModelVolumeType::SUPPORT_BLOCKER ||
         new_type == Slic3r::ModelVolumeType::SUPPORT_ENFORCER) &&
        (vol->is_svg() || vol->is_text())) {
        throw Slic3r::RuntimeError("Support blocker or enforcer cannot be set on SVG or text volume");
    }

    // Last-solid-part guard: when converting away from MODEL_PART, ensure at least one solid part remains in the object.
    if (new_type != Slic3r::ModelVolumeType::MODEL_PART && vol->type() == Slic3r::ModelVolumeType::MODEL_PART) {
        int solid_parts_cnt = 0;
        for (const auto* v : obj->volumes) {
            if (v && v->type() == Slic3r::ModelVolumeType::MODEL_PART) {
                ++solid_parts_cnt;
            }
        }
        if (solid_parts_cnt <= 1) {
            throw Slic3r::RuntimeError("The type of the last solid object part cannot be changed.");
        }
    }

    if (vol->type() != new_type) {
        vol->set_type(new_type);
        obj->sort_volumes(true);
        obj->invalidate_bounding_box();
    }

    return json{
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"type", volume_type_to_string(vol->type())}
    };
}

json mergeObjects(Slic3r::Model& model, const json& args, Slic3r::PlateDataPtrs* plates, const Slic3r::DynamicPrintConfig* config) {
    // 1. Collect selected instances (objectId, instanceId)
    std::vector<std::pair<size_t, size_t>> selected_refs;
    std::set<std::pair<size_t, size_t>> seen_refs;

    if (args.contains("instances")) {
        if (!args["instances"].is_array())
            throw Slic3r::RuntimeError("instances must be an array");
        for (const auto& item : args["instances"]) {
            if (!item.is_object() || !item.contains("objectId") || !item.contains("instanceId"))
                throw Slic3r::RuntimeError("Invalid instance reference");
            const auto& oid = item["objectId"];
            const auto& iid = item["instanceId"];
            if (!oid.is_number_unsigned() || !iid.is_number_unsigned())
                throw Slic3r::RuntimeError("Invalid instance reference ID");
            size_t o = oid.get<size_t>();
            size_t i = iid.get<size_t>();
            if (seen_refs.insert({o, i}).second) {
                selected_refs.emplace_back(o, i);
            }
        }
    } else if (args.contains("objectIds")) {
        if (!args["objectIds"].is_array())
            throw Slic3r::RuntimeError("objectIds must be an array");
        for (const auto& item : args["objectIds"]) {
            if (!item.is_number_unsigned())
                throw Slic3r::RuntimeError("Invalid object ID");
            size_t o = item.get<size_t>();
            const auto* obj = find_object(model, o);
            if (!obj)
                throw Slic3r::RuntimeError("Object not found: " + std::to_string(o));
            for (const auto* inst : obj->instances) {
                if (inst && seen_refs.insert({o, inst->id().id}).second) {
                    selected_refs.emplace_back(o, inst->id().id);
                }
            }
        }
    } else {
        throw Slic3r::RuntimeError("mergeObjects requires 'instances' or 'objectIds'");
    }

    if (selected_refs.size() < 2) {
        throw Slic3r::RuntimeError("At least two objects or instances must be selected to merge");
    }

    // 2. Validate all objects and instances exist
    std::map<size_t, std::vector<const Slic3r::ModelInstance*>> obj_instances_map;
    std::map<size_t, std::vector<size_t>> obj_instance_indices_map;
    for (const auto& [o_id, i_id] : selected_refs) {
        const auto* obj = find_object(model, o_id);
        if (!obj)
            throw Slic3r::RuntimeError("Object not found: " + std::to_string(o_id));

        const Slic3r::ModelInstance* target_inst = nullptr;
        size_t inst_idx = 0;
        for (size_t idx = 0; idx < obj->instances.size(); ++idx) {
            if (obj->instances[idx] && obj->instances[idx]->id().id == i_id) {
                target_inst = obj->instances[idx];
                inst_idx = idx;
                break;
            }
        }
        if (!target_inst)
            throw Slic3r::RuntimeError("Instance not found: " + std::to_string(i_id));

        obj_instances_map[o_id].push_back(target_inst);
        obj_instance_indices_map[o_id].push_back(inst_idx);
    }

    // 3. Cut objects and cut connector validation
    for (const auto& [o_id, inst_list] : obj_instances_map) {
        const auto* obj = find_object(model, o_id);
        if (obj->is_cut()) {
            throw Slic3r::RuntimeError("Cannot merge cut objects with connectors");
        }
        for (const auto* vol : obj->volumes) {
            if (vol && (vol->cut_info.is_connector || vol->is_cut_connector())) {
                throw Slic3r::RuntimeError("Cannot merge cut objects with connectors");
            }
        }
    }

    // 4. Layer height profiles & ranges validation:
    // Do not apply one source profile/range to an originally default object.
    // Require representable identical semantics or conservatively refuse custom layer profiles/ranges.
    const auto* first_obj = find_object(model, obj_instances_map.begin()->first);
    const auto first_profile = first_obj->layer_height_profile.get();
    const auto& first_ranges = first_obj->layer_config_ranges;

    for (const auto& [o_id, inst_list] : obj_instances_map) {
        const auto* obj = find_object(model, o_id);
        if (obj->layer_height_profile.get() != first_profile) {
            throw Slic3r::RuntimeError("Cannot merge objects with incompatible layer height profiles");
        }
        if (obj->layer_config_ranges.size() != first_ranges.size()) {
            throw Slic3r::RuntimeError("Cannot merge objects with incompatible layer config ranges");
        }
        auto it1 = first_ranges.begin();
        auto it2 = obj->layer_config_ranges.begin();
        for (; it1 != first_ranges.end(); ++it1, ++it2) {
            if (it1->first != it2->first) {
                throw Slic3r::RuntimeError("Cannot merge objects with incompatible layer config ranges");
            }
            if (it1->second.keys() != it2->second.keys()) {
                throw Slic3r::RuntimeError("Cannot merge objects with incompatible layer config ranges");
            }
            for (const auto& rk : it1->second.keys()) {
                const auto* o1 = it1->second.option(rk);
                const auto* o2 = it2->second.option(rk);
                if (!o1 || !o2 || *o1 != *o2) {
                    throw Slic3r::RuntimeError("Cannot merge objects with incompatible layer config ranges");
                }
            }
        }
    }

    // 5. Config compatibility validation:
    // Collect every key present on any source object. Compare its effective value across ALL source objects.
    std::set<std::string> all_keys_to_check;
    for (const auto& [o_id, inst_list] : obj_instances_map) {
        const auto* obj = find_object(model, o_id);
        for (const auto& k : obj->config.keys()) {
            if (k != "extruder") {
                all_keys_to_check.insert(k);
            }
        }
    }

    for (const auto& key : all_keys_to_check) {
        std::string first_val_serialized;
        bool have_first = false;
        for (const auto& [o_id, inst_list] : obj_instances_map) {
            const auto* obj = find_object(model, o_id);
            std::string eff_val;
            if (obj->config.has(key)) {
                eff_val = obj->config.opt_serialize(key);
            } else if (config && config->has(key)) {
                eff_val = config->opt_serialize(key);
            } else {
                eff_val = "__unset__";
            }
            if (!have_first) {
                first_val_serialized = eff_val;
                have_first = true;
            } else if (eff_val != first_val_serialized) {
                throw Slic3r::RuntimeError("Cannot merge objects with conflicting setting: " + key);
            }
        }
    }

    // 6. Solid model part check
    bool has_solid_part = false;
    for (const auto& [o_id, inst_list] : obj_instances_map) {
        const auto* obj = find_object(model, o_id);
        for (const auto* vol : obj->volumes) {
            if (vol && vol->type() == Slic3r::ModelVolumeType::MODEL_PART) {
                has_solid_part = true;
                break;
            }
        }
        if (has_solid_part) break;
    }
    if (!has_solid_part) {
        throw Slic3r::RuntimeError("Merged object must contain at least one solid model part");
    }

    // 7. Plate assignment check & pre-merge snapshot
    int target_plate_idx = 0;
    struct PlateEntryID {
        size_t object_id;
        size_t instance_id;
    };
    std::vector<std::vector<PlateEntryID>> plate_entries_by_id;

    if (plates && !plates->empty()) {
        plate_entries_by_id.resize(plates->size());
        for (size_t p_idx = 0; p_idx < plates->size(); ++p_idx) {
            for (const auto& [oi, ii] : (*plates)[p_idx]->objects_and_instances) {
                if (oi >= 0 && oi < int(model.objects.size())) {
                    const auto* obj = model.objects[oi];
                    if (obj && ii >= 0 && ii < int(obj->instances.size())) {
                        const auto* inst = obj->instances[ii];
                        if (inst) {
                            plate_entries_by_id[p_idx].push_back({obj->id().id, inst->id().id});
                        }
                    }
                }
            }
        }

        // Determine plate for each selected instance: prefer stored plate membership
        int first_plate = -1;
        for (const auto& [o_id, i_id] : selected_refs) {
            int assigned_plate = -1;
            for (size_t p_idx = 0; p_idx < plate_entries_by_id.size(); ++p_idx) {
                for (const auto& entry : plate_entries_by_id[p_idx]) {
                    if (entry.object_id == o_id && entry.instance_id == i_id) {
                        assigned_plate = static_cast<int>(p_idx);
                        break;
                    }
                }
                if (assigned_plate >= 0) break;
            }

            // Fallback to spatial bounding box if not stored
            if (assigned_plate < 0 && config) {
                double bed_width = 256.0, bed_depth = 256.0, bed_height = 256.0;
                OrcaEngine::getBedDimensions(*config, bed_width, bed_depth, bed_height);
                const auto* obj = find_object(model, o_id);
                for (size_t ii = 0; ii < obj->instances.size(); ++ii) {
                    if (obj->instances[ii]->id().id == i_id) {
                        Slic3r::BoundingBoxf3 inst_bbox = obj->instance_convex_hull_bounding_box(ii);
                        for (size_t k = 0; k < plates->size(); ++k) {
                            Slic3r::Vec3d origin = OrcaEngine::computePlateOrigin(static_cast<int>(k), plates->size(), bed_width, bed_depth);
                            Slic3r::BoundingBoxf3 pb(origin, origin + Slic3r::Vec3d(bed_width, bed_depth, bed_height));
                            if (pb.intersects(inst_bbox)) {
                                assigned_plate = static_cast<int>(k);
                                break;
                            }
                        }
                        if (assigned_plate < 0) {
                            Slic3r::Vec3d c = inst_bbox.center();
                            double min_dist_sq = std::numeric_limits<double>::max();
                            for (size_t k = 0; k < plates->size(); ++k) {
                                Slic3r::Vec3d pc = OrcaEngine::computePlateOrigin(static_cast<int>(k), plates->size(), bed_width, bed_depth) +
                                                   Slic3r::Vec3d(bed_width * 0.5, bed_depth * 0.5, bed_height * 0.5);
                                double d2 = (c.x() - pc.x()) * (c.x() - pc.x()) + (c.y() - pc.y()) * (c.y() - pc.y());
                                if (d2 < min_dist_sq) {
                                    min_dist_sq = d2;
                                    assigned_plate = static_cast<int>(k);
                                }
                            }
                        }
                        break;
                    }
                }
            }

            if (first_plate < 0) {
                first_plate = assigned_plate;
            } else if (assigned_plate >= 0 && assigned_plate != first_plate) {
                throw Slic3r::RuntimeError("Cannot merge instances from different plates");
            }
        }

        if (args.contains("plateIndex")) {
            if (!args["plateIndex"].is_number_integer()) {
                throw Slic3r::RuntimeError("plateIndex must be an integer");
            }
            int req_plate = args["plateIndex"].get<int>();
            if (first_plate >= 0 && first_plate != req_plate) {
                throw Slic3r::RuntimeError("Selected instance does not belong to specified plate");
            }
        }

        target_plate_idx = std::max(0, first_plate);
    }

    // 8. Validate optional name (string) before mutation
    std::string merged_name = "Assembly";
    if (args.contains("name")) {
        if (!args["name"].is_string()) {
            throw Slic3r::RuntimeError("name must be a string");
        }
        merged_name = args["name"].get<std::string>();
    }

    // 9. Printable states check:
    // Reject mixed printable states across source selected instances/objects before mutation.
    // Preserve same-state merges. Check source object printable plus instance printable.
    bool first_printable = false;
    bool have_printable_state = false;
    for (const auto& [o_id, i_id] : selected_refs) {
        const auto* obj = find_object(model, o_id);
        const Slic3r::ModelInstance* inst = nullptr;
        for (const auto* i : obj->instances) {
            if (i && i->id().id == i_id) {
                inst = i;
                break;
            }
        }
        if (!inst) continue;
        bool eff_printable = (obj->printable && inst->printable);
        if (!have_printable_state) {
            first_printable = eff_printable;
            have_printable_state = true;
        } else if (eff_printable != first_printable) {
            throw Slic3r::RuntimeError("Cannot merge objects with mixed printable states");
        }
    }

    // --- ALL VALIDATIONS PASSED: PERFORM MUTATION ---

    Slic3r::ModelObject* new_object = model.add_object();
    new_object->name = merged_name;
    new_object->printable = first_printable;
    new_object->add_instance();
    new_object->instances[0]->printable = first_printable;
    Slic3r::ModelConfig& new_config = new_object->config;

    for (const auto& [o_id, i_id] : selected_refs) {
        auto* object = find_object(model, o_id);
        const Slic3r::ModelInstance* inst = nullptr;
        for (const auto* i : object->instances) {
            if (i && i->id().id == i_id) {
                inst = i;
                break;
            }
        }
        if (!inst) continue;

        const Slic3r::Geometry::Transformation& transformation = inst->get_transformation();
        const Slic3r::Transform3d& transformation_matrix = transformation.get_matrix();

        for (const Slic3r::ModelVolume* volume : object->volumes) {
            Slic3r::ModelVolume* new_volume = new_object->add_volume(*volume);

            const Slic3r::Transform3d& volume_matrix = new_volume->get_matrix();
            Slic3r::Transform3d new_matrix = transformation_matrix * volume_matrix;
            new_volume->set_transformation(new_matrix);

            if (object->volumes.size() > 1) {
                new_volume->config.assign_config(volume->config);
            }
            auto option = new_volume->config.option("extruder");
            if (!option) {
                auto opt = object->config.option("extruder");
                if (opt) {
                    new_volume->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(opt->getInt()));
                }
            }
        }

        if (object->volumes.size() == 1 && object->config.has("extruder")) {
            Slic3r::ModelVolume* volume = new_object->volumes.back();
            const Slic3r::ConfigOption* option = object->config.option("extruder");
            if (option)
                volume->config.set_key_value("extruder", option->clone());
        }

        for (const auto& opt_key : object->config.keys()) {
            if (opt_key == "extruder") continue;
            if (!new_config.has(opt_key)) {
                const Slic3r::ConfigOption* option = object->config.option(opt_key);
                if (option)
                    new_config.set_key_value(opt_key, option->clone());
            }
        }

        if (!inst->auto_drop) {
            new_object->instances[0]->auto_drop = false;
        }

        for (const auto& range : object->layer_config_ranges)
            new_object->layer_config_ranges.emplace(range);

        if (object->layer_height_profile.get().size() > 4 && new_object->layer_height_profile.get().size() <= 4) {
            new_object->layer_height_profile.set(object->layer_height_profile.get());
        }

        Slic3r::BrimPoints temp_brim_points = object->brim_points;
        for (auto& p : temp_brim_points) {
            p.set_transform(transformation_matrix);
            new_object->brim_points.push_back(p);
        }
    }

    new_object->sort_volumes(true);

    // Center around origin without dropping Z to preserve exact world geometry
    new_object->center_around_origin();
    new_object->translate_instances(-new_object->origin_translation);
    new_object->origin_translation = Slic3r::Vec3d::Zero();

    Slic3r::Geometry::Transformation new_object_trsf = new_object->instances[0]->get_transformation();
    new_object->instances[0]->set_assemble_transformation(new_object_trsf);

    const Slic3r::Transform3d& new_object_inverse_matrix = new_object_trsf.get_matrix().inverse();
    for (auto& p : new_object->brim_points) {
        p.set_transform(new_object_inverse_matrix);
    }

    for (auto* v : new_object->volumes) v->set_new_unique_id();
    new_object->invalidate_bounding_box();

    // Delete selected instances from original objects
    std::map<size_t, std::set<size_t>> to_delete;
    for (const auto& [o_id, i_id] : selected_refs) {
        to_delete[o_id].insert(i_id);
    }

    for (const auto& [o_id, inst_ids] : to_delete) {
        auto* object = find_object(model, o_id);
        if (!object) continue;
        for (size_t i = object->instances.size(); i-- > 0;) {
            if (inst_ids.count(object->instances[i]->id().id)) {
                object->delete_instance(i);
            }
        }
        if (object->instances.empty()) {
            model.delete_object(object);
        } else {
            object->invalidate_bounding_box();
        }
    }

    // Update plate membership: preserve pre-merge plate entries, remove consumed, add merged instance to target plate
    if (plates && !plates->empty()) {
        std::set<std::pair<size_t, size_t>> consumed_set(selected_refs.begin(), selected_refs.end());

        for (size_t p_idx = 0; p_idx < plates->size(); ++p_idx) {
            auto& entries = plate_entries_by_id[p_idx];
            entries.erase(std::remove_if(entries.begin(), entries.end(), [&](const PlateEntryID& e) {
                return consumed_set.count({e.object_id, e.instance_id}) > 0;
            }), entries.end());
        }

        if (target_plate_idx >= 0 && target_plate_idx < int(plate_entries_by_id.size())) {
            plate_entries_by_id[target_plate_idx].push_back({new_object->id().id, new_object->instances[0]->id().id});
        }

        // Remap to mutated model indices
        for (size_t p_idx = 0; p_idx < plates->size(); ++p_idx) {
            auto* p = (*plates)[p_idx];
            p->objects_and_instances.clear();
            for (const auto& entry : plate_entries_by_id[p_idx]) {
                for (size_t oi = 0; oi < model.objects.size(); ++oi) {
                    if (model.objects[oi] && model.objects[oi]->id().id == entry.object_id) {
                        for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                            if (model.objects[oi]->instances[ii] && model.objects[oi]->instances[ii]->id().id == entry.instance_id) {
                                p->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    return json{
        {"objectId", new_object->id().id},
        {"id", new_object->id().id},
        {"instanceId", new_object->instances[0]->id().id},
        {"name", new_object->name},
        {"volumesCount", new_object->volumes.size()}
    };
}

} // namespace OrcaWasm
