#include "LayerHeightOps.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Slicing.hpp"
#include "libslic3r/SlicingAdaptive.hpp"
#include "libslic3r/Utils.hpp"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

size_t get_object_id(const json& args) {
    if (args.contains("objectId") && !args["objectId"].is_null()) {
        return args["objectId"].get<size_t>();
    } else if (args.contains("id") && !args["id"].is_null()) {
        return args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("Operation requires objectId");
    }
}

Slic3r::ModelObject* find_object(Slic3r::Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    if (object_id < model.objects.size())
        return model.objects[object_id];
    return nullptr;
}

Slic3r::SlicingParameters get_slicing_parameters(const Slic3r::ModelObject& obj, const Slic3r::DynamicPrintConfig& config) {
    // Profiles span the transformed object's height, independent of its position
    // on the bed. A centered mesh's world max_z is only half its height; such a
    // profile is rejected by PrintObject when slicing places the object on bed.
    // Zero selects PrintObject's raw_bounding_box height (including scale/rotation).
    return Slic3r::PrintObject::slicing_parameters(config, obj, 0.0f, Slic3r::Vec3d::Ones());
}

json build_ranges_json(const std::vector<double>& layers) {
    json ranges = json::array();
    for (size_t i = 0; i + 1 < layers.size(); i += 2) {
        ranges.push_back({
            {"bottom", layers[i]},
            {"top", layers[i + 1]},
            {"height", layers[i + 1] - layers[i]}
        });
    }
    return ranges;
}

} // namespace

json getLayerHeightProfile(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> profile = obj->layer_height_profile.get();
    bool has_custom = !profile.empty();
    Slic3r::PrintObject::update_layer_height_profile(*obj, slicing_params, profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"objectId", obj->id().id},
        {"profile", profile},
        {"minLayerHeight", slicing_params.min_layer_height},
        {"maxLayerHeight", slicing_params.max_layer_height},
        {"nominalHeight", slicing_params.layer_height},
        {"layerHeight", slicing_params.layer_height},
        {"firstLayerHeight", slicing_params.first_object_layer_height},
        {"totalHeight", slicing_params.object_print_z_height()},
        {"objectHeight", slicing_params.object_print_z_height()},
        {"hasCustomProfile", has_custom},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)}
    };
}

json setLayerHeightProfile(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    if (!args.contains("profile") || !args["profile"].is_array()) {
        throw Slic3r::RuntimeError("setLayerHeightProfile requires 'profile' array");
    }

    std::vector<double> profile = args["profile"].get<std::vector<double>>();
    if ((profile.size() % 2) != 0 || profile.size() < 4) {
        throw Slic3r::RuntimeError("Invalid layer height profile: must contain at least 2 [z, height] pairs");
    }

    auto slicing_params = get_slicing_parameters(*obj, config);
    // Clamp layer heights to valid printer boundaries
    for (size_t i = 1; i < profile.size(); i += 2) {
        profile[i] = std::clamp(profile[i], slicing_params.min_layer_height, slicing_params.max_layer_height);
    }

    obj->layer_height_profile.set(profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"success", true},
        {"objectId", obj->id().id},
        {"profile", profile},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)}
    };
}

json adaptiveLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    float quality = 0.5f;
    if (args.contains("quality")) {
        quality = args["quality"].get<float>();
    } else if (args.contains("qualityFactor")) {
        quality = args["qualityFactor"].get<float>();
    }
    quality = std::clamp(quality, 0.0f, 1.0f);

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> profile = Slic3r::layer_height_profile_adaptive(slicing_params, *obj, quality);

    obj->layer_height_profile.set(profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"success", true},
        {"objectId", obj->id().id},
        {"profile", profile},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)},
        {"minLayerHeight", slicing_params.min_layer_height},
        {"maxLayerHeight", slicing_params.max_layer_height}
    };
}

json smoothLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    unsigned int radius = 5;
    if (args.contains("radius")) {
        radius = args["radius"].get<unsigned int>();
    }

    bool keep_min = false;
    if (args.contains("keepMin")) {
        keep_min = args["keepMin"].get<bool>();
    } else if (args.contains("keep_min")) {
        keep_min = args["keep_min"].get<bool>();
    }

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> profile = obj->layer_height_profile.get();
    Slic3r::PrintObject::update_layer_height_profile(*obj, slicing_params, profile);

    Slic3r::HeightProfileSmoothingParams smooth_params(radius, keep_min);
    profile = Slic3r::smooth_height_profile(profile, slicing_params, smooth_params);

    obj->layer_height_profile.set(profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"success", true},
        {"objectId", obj->id().id},
        {"profile", profile},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)},
        {"minLayerHeight", slicing_params.min_layer_height},
        {"maxLayerHeight", slicing_params.max_layer_height}
    };
}

json adjustLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    if (!args.contains("z")) {
        throw Slic3r::RuntimeError("adjustLayerHeights requires 'z' coordinate");
    }
    double z = args["z"].get<double>();

    double delta = 0.005;
    if (args.contains("delta")) {
        delta = args["delta"].get<double>();
    } else if (args.contains("strength")) {
        delta = args["strength"].get<double>();
    }

    double band_width = 2.0;
    if (args.contains("bandWidth")) {
        band_width = args["bandWidth"].get<double>();
    } else if (args.contains("band_width")) {
        band_width = args["band_width"].get<double>();
    }

    std::string action_str = args.value("action", "increase");
    Slic3r::LayerHeightEditActionType action_type = Slic3r::LAYER_HEIGHT_EDIT_ACTION_INCREASE;
    if (action_str == "decrease") {
        action_type = Slic3r::LAYER_HEIGHT_EDIT_ACTION_DECREASE;
    } else if (action_str == "smooth") {
        action_type = Slic3r::LAYER_HEIGHT_EDIT_ACTION_SMOOTH;
    } else if (action_str == "reduce") {
        action_type = Slic3r::LAYER_HEIGHT_EDIT_ACTION_REDUCE;
    } else if (action_str != "increase") {
        throw Slic3r::RuntimeError("Unknown action: " + action_str + " (expected increase, decrease, smooth, reduce)");
    }

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> profile = obj->layer_height_profile.get();
    Slic3r::PrintObject::update_layer_height_profile(*obj, slicing_params, profile);

    Slic3r::adjust_layer_height_profile(*obj, slicing_params, profile, z, delta, band_width, action_type);

    obj->layer_height_profile.set(profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"success", true},
        {"objectId", obj->id().id},
        {"profile", profile},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)},
        {"minLayerHeight", slicing_params.min_layer_height},
        {"maxLayerHeight", slicing_params.max_layer_height}
    };
}

json resetLayerHeights(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    obj->layer_height_profile.clear();

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> default_profile;
    Slic3r::PrintObject::update_layer_height_profile(*obj, slicing_params, default_profile);
    auto layers = Slic3r::generate_object_layers(slicing_params, default_profile, false);

    return json{
        {"success", true},
        {"cleared", true},
        {"objectId", obj->id().id},
        {"profile", default_profile},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)}
    };
}

json getObjectLayers(
    Slic3r::Model& model,
    const Slic3r::DynamicPrintConfig& config,
    const json& args
) {
    size_t object_id = get_object_id(args);
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    auto slicing_params = get_slicing_parameters(*obj, config);
    std::vector<double> profile = obj->layer_height_profile.get();
    Slic3r::PrintObject::update_layer_height_profile(*obj, slicing_params, profile);

    auto layers = Slic3r::generate_object_layers(slicing_params, profile, false);

    return json{
        {"objectId", obj->id().id},
        {"layerCount", layers.size() / 2},
        {"layers", layers},
        {"ranges", build_ranges_json(layers)}
    };
}

} // namespace OrcaWasm
