#include "LayerEventOps.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/CustomGCode.hpp"
#include "libslic3r/Utils.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace OrcaWasm {

namespace {

std::string type_to_string(Slic3r::CustomGCode::Type type) {
    switch (type) {
        case Slic3r::CustomGCode::PausePrint:
            return "pause";
        case Slic3r::CustomGCode::Custom:
            return "custom";
        case Slic3r::CustomGCode::ColorChange:
            return "color_change";
        case Slic3r::CustomGCode::ToolChange:
            return "tool_change";
        case Slic3r::CustomGCode::Template:
            return "template";
        case Slic3r::CustomGCode::Unknown:
        default:
            return "unknown";
    }
}

nlohmann::json item_to_json(const Slic3r::CustomGCode::Item& item) {
    nlohmann::json j = {
        {"printZ", item.print_z},
        {"type", type_to_string(item.type)},
        {"extruder", item.extruder},
        {"color", item.color},
        {"extra", item.extra}
    };
    if (item.type == Slic3r::CustomGCode::PausePrint) {
        j["message"] = item.extra.empty() ? item.color : item.extra;
        j["gcode"] = "";
    } else if (item.type == Slic3r::CustomGCode::Custom) {
        j["gcode"] = item.extra;
        j["message"] = "";
    } else {
        j["gcode"] = item.extra;
        j["message"] = item.color;
    }
    return j;
}

int parse_plate_index(const nlohmann::json& args) {
    if (args.contains("plateIndex")) {
        const auto& v = args["plateIndex"];
        if (!v.is_number_integer()) {
            throw Slic3r::RuntimeError("Invalid plateIndex: must be an integer");
        }
        if (v.is_number_unsigned()) {
            uint64_t u = v.get<uint64_t>();
            if (u > static_cast<uint64_t>(std::numeric_limits<int>::max())) {
                throw Slic3r::RuntimeError("Invalid plateIndex: out of range");
            }
            return static_cast<int>(u);
        } else {
            int64_t s = v.get<int64_t>();
            if (s < 0) {
                throw Slic3r::RuntimeError("Invalid plateIndex: must be non-negative");
            }
            if (s > std::numeric_limits<int>::max()) {
                throw Slic3r::RuntimeError("Invalid plateIndex: out of range");
            }
            return static_cast<int>(s);
        }
    }
    return 0;
}

} // anonymous namespace

nlohmann::json getLayerEvents(
    const Slic3r::Model& model,
    const nlohmann::json& args
) {
    int plate_index = parse_plate_index(args);

    nlohmann::json events = nlohmann::json::array();
    auto it = model.plates_custom_gcodes.find(plate_index);
    if (it != model.plates_custom_gcodes.end()) {
        for (const auto& item : it->second.gcodes) {
            events.push_back(item_to_json(item));
        }
    }

    return nlohmann::json{
        {"plateIndex", plate_index},
        {"count", events.size()},
        {"events", events}
    };
}

nlohmann::json setLayerEvents(
    Slic3r::Model& model,
    const nlohmann::json& args
) {
    int plate_index = parse_plate_index(args);

    if (!args.contains("events") || !args["events"].is_array()) {
        throw Slic3r::RuntimeError("setLayerEvents requires an 'events' array");
    }

    const auto& events_json = args["events"];
    std::vector<Slic3r::CustomGCode::Item> batch;
    batch.reserve(events_json.size());

    // Validate entire batch BEFORE mutating model state
    for (size_t i = 0; i < events_json.size(); ++i) {
        const auto& item_json = events_json[i];
        if (!item_json.is_object()) {
            throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " must be an object");
        }

        if (!item_json.contains("printZ") || !item_json["printZ"].is_number()) {
            throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " missing valid 'printZ'");
        }
        double print_z = item_json["printZ"].get<double>();
        if (!std::isfinite(print_z) || print_z < 0.0) {
            throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has invalid printZ: must be finite and non-negative");
        }

        if (!item_json.contains("type") || !item_json["type"].is_string()) {
            throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " missing 'type' string");
        }
        std::string type_str = item_json["type"].get<std::string>();

        int extruder = 1;
        if (item_json.contains("extruder")) {
            const auto& ext_val = item_json["extruder"];
            if (!ext_val.is_number_integer()) {
                throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has invalid extruder: must be an integer");
            }
            if (ext_val.is_number_unsigned()) {
                uint64_t u = ext_val.get<uint64_t>();
                if (u < 1 || u > 255) {
                    throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has out-of-range extruder (must be between 1 and 255)");
                }
                extruder = static_cast<int>(u);
            } else {
                int64_t s = ext_val.get<int64_t>();
                if (s < 1 || s > 255) {
                    throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has out-of-range extruder (must be between 1 and 255)");
                }
                extruder = static_cast<int>(s);
            }
        }

        Slic3r::CustomGCode::Type type;
        std::string color;
        std::string extra;

        if (type_str == "pause" || type_str == "PausePrint") {
            type = Slic3r::CustomGCode::PausePrint;
            std::string message;
            if (item_json.contains("message")) {
                if (!item_json["message"].is_string()) {
                    throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has invalid 'message': must be a string");
                }
                message = item_json["message"].get<std::string>();
            }
            if (item_json.contains("gcode") && !item_json["gcode"].is_string()) {
                throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has invalid 'gcode': must be a string");
            }
            color = message;
            extra = message;
        } else if (type_str == "custom" || type_str == "Custom") {
            type = Slic3r::CustomGCode::Custom;
            if (!item_json.contains("gcode") || !item_json["gcode"].is_string()) {
                throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " of type 'custom' requires string 'gcode'");
            }
            std::string gcode = item_json["gcode"].get<std::string>();
            if (gcode.empty()) {
                throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " of type 'custom' requires non-empty 'gcode'");
            }
            if (item_json.contains("message") && !item_json["message"].is_string()) {
                throw Slic3r::RuntimeError("Event at index " + std::to_string(i) + " has invalid 'message': must be a string");
            }
            color = "";
            extra = gcode;
        } else if (type_str == "color_change" || type_str == "ColorChange" || type_str == "filament_change" ||
                   type_str == "tool_change" || type_str == "ToolChange") {
            throw Slic3r::RuntimeError(
                "Filament/color change layer events are not supported: existing native engine slicing pipeline has color change emission disabled in libslic3r/GCode.cpp (#if 0)"
            );
        } else {
            throw Slic3r::RuntimeError(
                "Unsupported layer event type: '" + type_str + "'. Only 'pause' and 'custom' are supported."
            );
        }

        Slic3r::CustomGCode::Item item;
        item.print_z = print_z;
        item.type = type;
        item.extruder = extruder;
        item.color = std::move(color);
        item.extra = std::move(extra);
        batch.push_back(std::move(item));
    }

    // Sort ascending by print_z for native ToolOrdering compatibility
    std::stable_sort(batch.begin(), batch.end());

    // Check for duplicate events at the same printZ height.
    // Native slicing pipeline (ToolOrdering::assign_custom_gcodes) binds at most one
    // CustomGCode::Item per layer tool. Duplicate same-Z events are rejected to prevent
    // claiming unsupported multi-event semantics.
    for (size_t i = 1; i < batch.size(); ++i) {
        if (std::abs(batch[i].print_z - batch[i - 1].print_z) < 1e-4) {
            throw Slic3r::RuntimeError(
                "Duplicate layer event at printZ " + std::to_string(batch[i].print_z) +
                ": native engine supports at most one event per layer height"
            );
        }
    }

    // Entire batch is valid; commit mutation to model
    auto& info = model.plates_custom_gcodes[plate_index];
    info.gcodes = std::move(batch);
    if (info.mode == Slic3r::CustomGCode::Mode::Undef) {
        info.mode = Slic3r::CustomGCode::Mode::SingleExtruder;
    }
    Slic3r::CustomGCode::check_mode_for_custom_gcode_per_print_z(info);

    nlohmann::json res_events = nlohmann::json::array();
    for (const auto& item : info.gcodes) {
        res_events.push_back(item_to_json(item));
    }

    return nlohmann::json{
        {"plateIndex", plate_index},
        {"count", res_events.size()},
        {"events", res_events}
    };
}

nlohmann::json clearLayerEvents(
    Slic3r::Model& model,
    const nlohmann::json& args
) {
    if (args.contains("allPlates")) {
        if (!args["allPlates"].is_boolean()) {
            throw Slic3r::RuntimeError("Invalid allPlates: must be a boolean");
        }
    }
    bool all_plates = args.value("allPlates", false);
    if (all_plates) {
        size_t total_cleared = 0;
        for (auto& [_, info] : model.plates_custom_gcodes) {
            total_cleared += info.gcodes.size();
            info.gcodes.clear();
        }
        return nlohmann::json{
            {"allPlates", true},
            {"clearedCount", total_cleared},
            {"remainingCount", 0}
        };
    }

    int plate_index = parse_plate_index(args);

    double target_z = -1.0;
    bool has_target_z = false;
    if (args.contains("printZ")) {
        if (!args["printZ"].is_number()) {
            throw Slic3r::RuntimeError("Invalid printZ: must be a number");
        }
        target_z = args["printZ"].get<double>();
        if (!std::isfinite(target_z) || target_z < 0.0) {
            throw Slic3r::RuntimeError("Invalid printZ: must be finite and non-negative");
        }
        has_target_z = true;
    }

    auto it = model.plates_custom_gcodes.find(plate_index);
    if (it == model.plates_custom_gcodes.end()) {
        return nlohmann::json{
            {"plateIndex", plate_index},
            {"clearedCount", 0},
            {"remainingCount", 0}
        };
    }

    if (has_target_z) {
        auto& gcodes = it->second.gcodes;
        size_t initial_size = gcodes.size();
        gcodes.erase(
            std::remove_if(gcodes.begin(), gcodes.end(), [target_z](const Slic3r::CustomGCode::Item& item) {
                return std::abs(item.print_z - target_z) < 1e-4;
            }),
            gcodes.end()
        );
        size_t cleared = initial_size - gcodes.size();
        return nlohmann::json{
            {"plateIndex", plate_index},
            {"clearedCount", cleared},
            {"remainingCount", gcodes.size()}
        };
    }

    size_t cleared = it->second.gcodes.size();
    it->second.gcodes.clear();
    return nlohmann::json{
        {"plateIndex", plate_index},
        {"clearedCount", cleared},
        {"remainingCount", 0}
    };
}

} // namespace OrcaWasm
