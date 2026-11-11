#include <unordered_set>
#include "Engine.hpp"
#include "ConfigRules.hpp"
#include "ProjectOps.hpp"
#include "ObjectOps.hpp"
#include "PlateOps.hpp"
#include "PaintOps.hpp"
#include "PaintToolsOps.hpp"
#include "LayerHeightOps.hpp"
#include "TextOps.hpp"
#include "EditOps.hpp"
#include "SvgOps.hpp"
#include "BrimEarsOps.hpp"
#include "CutOps.hpp"
#include "CalibOps.hpp"
#include "RepairOps.hpp"
#include "CutConnectorOps.hpp"
#include "LayerEventOps.hpp"
#include "MeasureOps.hpp"
#include "libslic3r/Arrange.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"
#include "libslic3r/ClipperUtils.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ModelArrange.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintBase.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Thread.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/GCode/WipeTowerEstimate.hpp"
#include "libslic3r/Format/STL.hpp"
#include "libslic3r/Format/3mf.hpp"

#include <tbb/task_arena.h>

#include <boost/log/core.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/expressions.hpp>
#include <boost/algorithm/string/predicate.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cfloat>
#include <cmath>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <filesystem>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <mutex>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

namespace {

// Some legacy numeric deserializers accept incomplete input. Validate browser
// edits before invoking them, without changing desktop profile compatibility.
bool valid_numeric_option(const Slic3r::ConfigOption& option, const std::string& value) {
    const int scalar_type = int(option.type()) & ~int(Slic3r::coVectorType);
    const bool integer = scalar_type == Slic3r::coInt;
    const bool percent = scalar_type == Slic3r::coPercent || scalar_type == Slic3r::coFloatOrPercent;
    const bool boolean = scalar_type == Slic3r::coBool;
    if (!integer && !percent && !boolean && scalar_type != Slic3r::coFloat)
        return true;
    if (value.empty() || value.back() == ',' ||
        (!(int(option.type()) & int(Slic3r::coVectorType)) && value.find(',') != std::string::npos)) return false;
    std::istringstream cells(value);
    std::string cell;
    while (std::getline(cells, cell, ',')) {
        const auto first = cell.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) return false;
        cell = cell.substr(first, cell.find_last_not_of(" \t\r\n") - first + 1);
        if (option.nullable() && cell == "nil") continue;
        if (boolean) {
            if (cell != "0" && cell != "1") return false;
            continue;
        }
        if (percent && cell.back() == '%') cell.pop_back();
        std::istringstream number(cell);
        if (integer) {
            int parsed = 0;
            if (!(number >> parsed)) return false;
        } else {
            double parsed = 0.;
            if (!(number >> parsed) || !std::isfinite(parsed)) return false;
        }
        number >> std::ws;
        if (!number.eof()) return false;
    }
    return true;
}

// Legacy conversion runs explicitly once, before schema validation. The native
// deserializer still handles shortcuts, but must not migrate values a second time
// (some historical percentage/unit conversions are not idempotent).
struct CanonicalConfig : Slic3r::DynamicPrintConfig {
    void handle_legacy(Slic3r::t_config_option_key&, std::string&) const override {}
};

Slic3r::DynamicPrintConfig normalize_options(const json& values, json& errors) {
    CanonicalConfig normalized;
    if (!values.is_object()) throw Slic3r::RuntimeError("Options must be an object");
    for (const auto& [original, value] : values.items()) {
        std::string key = original;
        std::string serialized;
        if (value.is_string()) serialized = value.get<std::string>();
        else if (value.is_number_float()) serialized = Slic3r::float_to_string_decimal_point(value.get<double>());
        else if (value.is_number()) serialized = value.dump();
        else if (value.is_boolean()) serialized = value.get<bool>() ? "1" : "0";
        else if (value.is_array()) {
            const auto* def = Slic3r::print_config_def.get(key);
            const char separator = def && def->type == Slic3r::coStrings ? ';' : ',';
            for (size_t i = 0; i < value.size(); ++i) {
                const auto& cell = value[i];
                if (i) serialized += separator;
                serialized += cell.is_string() ? cell.get<std::string>() : cell.dump();
            }
        }
        Slic3r::PrintConfigDef::handle_legacy(key, serialized);
        if (key.empty() || !Slic3r::print_config_def.has(key)) {
            errors.push_back({{"key", original}, {"error", "Unknown or retired option key"}, {"code", "unknown_key"}, {"fatal", false}});
            continue;
        }
        // An explicit canonical key wins even if its value is malformed; do not
        // hide that error by accepting the alias instead.
        if (key != original && values.contains(key)) continue;
        if (!value.is_primitive() || value.is_null()) {
            if (!value.is_array()) {
                errors.push_back({{"key", original}, {"error", "Unsupported value type"}, {"code", "unsupported_type"}, {"fatal", true}});
                continue;
            }
        }
        try {
            std::unique_ptr<Slic3r::ConfigOption> option(Slic3r::print_config_def.get(key)->create_empty_option());
            if (!valid_numeric_option(*option, serialized)) throw Slic3r::RuntimeError("Invalid numeric option value");
            normalized.set_deserialize_strict(key, serialized);
        } catch (const std::exception& e) {
            errors.push_back({{"key", original}, {"error", e.what()}, {"code", "invalid_value"}, {"fatal", true}});
        }
    }
    return normalized;
}

bool has_fatal_errors(const json& errors) {
    return std::any_of(errors.begin(), errors.end(), [](const json& error) { return error.value("fatal", false); });
}

bool is_slot_map(const std::string& key) {
    return key == "filament_map" || key == "filament_volume_map" || key == "filament_nozzle_map";
}

bool is_slot_selector(const std::string& key) {
    static const std::set<std::string> keys = {"outer_wall_filament_id", "inner_wall_filament_id",
        "sparse_infill_filament_id", "internal_solid_filament_id", "top_surface_filament_id",
        "bottom_surface_filament_id", "support_filament", "support_interface_filament", "wipe_tower_filament"};
    return keys.count(key) != 0;
}

int remap_slot_selector(int value, size_t slot) {
    if (value == int(slot + 1)) return 1;
    return value > int(slot + 1) ? value - 1 : value; // Default 0 stays Default.
}

template<class Config> void remap_slot_selectors(Config& config, size_t slot) {
    for (const auto& key : config.keys()) {
        if (!is_slot_selector(key)) continue;
        const auto* option = dynamic_cast<const Slic3r::ConfigOptionInt*>(config.option(key));
        if (option && remap_slot_selector(option->value, slot) != option->value)
            config.set_key_value(key, new Slic3r::ConfigOptionInt(remap_slot_selector(option->value, slot)));
    }
}

Slic3r::DynamicPrintConfig project_removed_slot(const Slic3r::DynamicPrintConfig& config,
                                               size_t count, size_t slot, bool filament_vectors) {
    auto projected = config;
    remap_slot_selectors(projected, slot);
    const auto& filament_keys = Slic3r::Preset::filament_options();
    for (const auto& key : config.keys()) {
        const bool map = is_slot_map(key);
        if (!map && (!filament_vectors || (key != "filament_colour" &&
            std::find(filament_keys.begin(), filament_keys.end(), key) == filament_keys.end()))) continue;
        auto* vector = dynamic_cast<Slic3r::ConfigOptionVectorBase*>(projected.option(key));
        if (!vector) continue;
        if (vector->size() < count || vector->size() % count != 0 || (map && vector->size() != count))
            throw Slic3r::RuntimeError("Invalid filament vector stride: " + key);
        const size_t stride = map ? 1 : vector->size() / count;
        const size_t remaining = vector->size() - stride;
        const auto* source = config.option(key);
        for (size_t i = slot * stride; i < remaining; ++i) vector->set_at(source, i, i + stride);
        vector->resize(remaining);
    }
    return projected;
}

json serialize_option_def(const Slic3r::ConfigOptionDef& def) {
    json j = json::object();

    std::string type_str;
    switch (def.type) {
    case Slic3r::coFloat:            type_str = "float"; break;
    case Slic3r::coFloats:           type_str = "floats"; break;
    case Slic3r::coInt:              type_str = "int"; break;
    case Slic3r::coInts:             type_str = "ints"; break;
    case Slic3r::coString:           type_str = "string"; break;
    case Slic3r::coStrings:          type_str = "strings"; break;
    case Slic3r::coPercent:          type_str = "percent"; break;
    case Slic3r::coPercents:         type_str = "percents"; break;
    case Slic3r::coFloatOrPercent:   type_str = "floatOrPercent"; break;
    case Slic3r::coFloatsOrPercents: type_str = "floatsOrPercents"; break;
    case Slic3r::coPoint:            type_str = "point"; break;
    case Slic3r::coPoints:           type_str = "points"; break;
    case Slic3r::coPoint3:           type_str = "point3"; break;
    case Slic3r::coBool:             type_str = "bool"; break;
    case Slic3r::coBools:            type_str = "bools"; break;
    case Slic3r::coEnum:             type_str = "enum"; break;
    case Slic3r::coEnums:            type_str = "enums"; break;
    case Slic3r::coPointsGroups:     type_str = "pointsGroups"; break;
    case Slic3r::coIntsGroups:       type_str = "intsGroups"; break;
    case Slic3r::coNone:             type_str = "none"; break;
    default:                         type_str = "unknown"; break;
    }
    j["type"] = type_str;

    if (!def.label.empty()) {
        j["label"] = def.label;
    }
    if (!def.full_label.empty()) {
        j["fullLabel"] = def.full_label;
    }
    if (!def.category.empty()) {
        j["category"] = def.category;
    }
    if (!def.tooltip.empty()) {
        j["tooltip"] = def.tooltip;
    }
    if (!def.sidetext.empty()) {
        j["sidetext"] = def.sidetext;
    }

    switch (def.mode) {
    case Slic3r::comAdvanced: j["mode"] = "advanced"; break;
    case Slic3r::comExpert:   j["mode"] = "expert"; break;
    case Slic3r::comDevelop:  j["mode"] = "develop"; break;
    case Slic3r::comSimple:
    default:                  j["mode"] = "simple"; break;
    }

    if (def.min > -FLT_MAX) {
        j["min"] = def.min;
    }
    if (def.max < FLT_MAX) {
        j["max"] = def.max;
    }

    if (def.default_value) {
        std::string serialized_default = def.default_value->serialize();
        if (!serialized_default.empty()) {
            j["default"] = serialized_default;
        }
    }

    if (!def.enum_values.empty()) {
        j["enumValues"] = def.enum_values;
    }
    if (!def.enum_labels.empty()) {
        j["enumLabels"] = def.enum_labels;
    }

    if (def.nullable) {
        j["nullable"] = true;
    }
    if (def.readonly) {
        j["readonly"] = true;
    }
    if (def.multiline) {
        j["multiline"] = true;
    }

    switch (def.gui_type) {
    case Slic3r::ConfigOptionDef::GUIType::i_enum_open:          j["guiType"] = "i_enum_open"; break;
    case Slic3r::ConfigOptionDef::GUIType::f_enum_open:          j["guiType"] = "f_enum_open"; break;
    case Slic3r::ConfigOptionDef::GUIType::color:                j["guiType"] = "color"; break;
    case Slic3r::ConfigOptionDef::GUIType::select_open:          j["guiType"] = "select_open"; break;
    case Slic3r::ConfigOptionDef::GUIType::slider:               j["guiType"] = "slider"; break;
    case Slic3r::ConfigOptionDef::GUIType::legend:               j["guiType"] = "legend"; break;
    case Slic3r::ConfigOptionDef::GUIType::one_string:           j["guiType"] = "one_string"; break;
    case Slic3r::ConfigOptionDef::GUIType::plugin_picker:        j["guiType"] = "plugin_picker"; break;
    case Slic3r::ConfigOptionDef::GUIType::plugin_config:        j["guiType"] = "plugin_config"; break;
    case Slic3r::ConfigOptionDef::GUIType::printer_agent_select: j["guiType"] = "printer_agent_select"; break;
    case Slic3r::ConfigOptionDef::GUIType::undefined:
    default:
        break;
    }

    if (!def.gui_flags.empty()) {
        j["guiFlags"] = def.gui_flags;
    }

    return j;
}


Slic3r::Vec3d parse_vec3d(const json& j) {
    if (j.is_array() && j.size() >= 3) {
        return Slic3r::Vec3d(j[0].get<double>(), j[1].get<double>(), j[2].get<double>());
    } else if (j.is_object() && j.contains("x") && j.contains("y") && j.contains("z")) {
        return Slic3r::Vec3d(j["x"].get<double>(), j["y"].get<double>(), j["z"].get<double>());
    }
    throw Slic3r::RuntimeError("Expected 3D vector [x, y, z]");
}

} // namespace

class Engine::Impl {
public:
    Impl();
    ~Impl();

    int submit(const std::string& op, const std::string& argsJson);
    std::string poll(int jobId);
    std::string progress();
    void cancel();

private:
    struct Job {
        int id;
        std::string op;
        std::string argsJson;
    };

    void worker_thread_loop();
    std::string execute_job(int jobId, const std::string& op, const std::string& argsJson);

    json op_init(const json& args);
    json op_loadVendors(const json& args);
    json op_listPresets(const json& args);
    json op_getCompatiblePresets(const json& args);
    json op_selectPresets(const json& args);
    json op_removeFilamentSlot(const json& args);
    json op_getConfig(const json& args);
    json op_getWipeTowerPreview(const json& args);
    json op_getPresetConfig(const json& args);
    json op_mergeFilamentPresets(const json& args);
    json op_getConfigDef(const json& args);
    json op_evaluateRules(const json& args);
    json op_setOptions(const json& args);
    json op_normalizeOptions(const json& args);
    json op_resolvePreset(const json& args);
    json op_setOption(const json& args);
    json op_getOption(const json& args);
    json op_resetOptions(const json& args);
    json op_loadModel(const json& args);
    json op_arrange(const json& args);
    json op_placeObjects(const json& args);
    json op_addModel(const json& args);
    json op_loadStepMesh(const json& args);
    json commit_loaded_model(Slic3r::Model&& loaded_model, const std::string& path, bool replace);
    json op_listObjects(const json& args);
    json op_getMesh(const json& args);
    json op_setInstanceTransform(const json& args);
    json op_deleteObject(const json& args);
    json op_moveObject(const json& args);
    json op_moveVolume(const json& args);
    json op_duplicateInstance(const json& args);
    json op_mirrorInstance(const json& args);
    json op_cloneObject(const json& args);
    json op_copySelection(const json& args);
    json op_pasteSelection(const json& args);
    json op_exportModel(const json& args);
    json op_openProject(const json& args);
    json op_saveProject(const json& args);
    json op_getObjectTree(const json& args);
    json op_addVolume(const json& args);
    json op_deleteVolume(const json& args);
    json op_renameObject(const json& args);
    json op_renameVolume(const json& args);
    json op_setObjectConfig(const json& args);
    json op_resetObjectConfig(const json& args);
    json op_setVolumeExtruder(const json& args);
    json op_mergeObjects(const json& args);
    json op_setVolumeType(const json& args);
    json op_listPlates(const json& args);
    json op_addPlate(const json& args);
    json op_duplicatePlate(const json& args);
    json op_deletePlate(const json& args);
    json op_setPlateConfig(const json& args);
    json op_getSupportPainting(const json& args);
    json op_setSupportPainting(const json& args);
    json op_clearSupportPainting(const json& args);
    json op_getSeamPainting(const json& args);
    json op_setSeamPainting(const json& args);
    json op_clearSeamPainting(const json& args);
    json op_setupCalibration(const json& args);
    json op_cutObject(const json& args);
    json op_parsePreset(const json& args);
    json op_cutObjectWithConnectors(const json& args);
    json op_getMeshHealth(const json& args);
    json op_checkMeshHealth(const json& args);
    json op_repairObject(const json& args);
    json op_repairMesh(const json& args);
    json op_paintStroke(const json& args);
    json op_getPaintOverlay(const json& args);
    json op_getPaintData(const json& args);
    json op_setPaintData(const json& args);
    json op_clearPaint(const json& args);
    json op_getLayerHeightProfile(const json& args);
    json op_setLayerHeightProfile(const json& args);
    json op_adaptiveLayerHeights(const json& args);
    json op_smoothLayerHeights(const json& args);
    json op_adjustLayerHeights(const json& args);
    json op_resetLayerHeights(const json& args);
    json op_getObjectLayers(const json& args);
    json op_addText(const json& args);
    json op_autoOrient(const json& args);
    json op_getPlanarFacets(const json& args);
    json op_placeOnFace(const json& args);
    json op_splitObject(const json& args);
    json op_splitVolume(const json& args);
    json op_simplifyVolume(const json& args);
    json op_meshBoolean(const json& args);
    json op_addSvg(const json& args);
    json op_updateSvg(const json& args);
    json op_getSvg(const json& args);
    json op_getBrimEars(const json& args);
    json op_setBrimEars(const json& args);
    json op_clearBrimEars(const json& args);

    json op_updateText(const json& args);
    json op_getText(const json& args);
    json op_getLayerEvents(const json& args);
    json op_setLayerEvents(const json& args);
    json op_clearLayerEvents(const json& args);
    Slic3r::DynamicPrintConfig layer_config() const;
    std::string op_slice(int jobId, const json& args);

    // Job queue
    std::atomic<int> m_next_job_id{1};
    std::mutex m_queue_mutex;
    std::condition_variable m_cv;
    std::deque<Job> m_queue;
    bool m_stop{false};

    // Results
    std::mutex m_results_mutex;
    std::unordered_map<int, std::string> m_results;

    // Worker thread
    std::thread m_engine_thread;

    // Progress and cancel
    std::mutex m_cancel_mutex;
    Slic3r::Print* m_current_print{nullptr};
    bool m_cancel_requested{false};
    int m_slice_jobs_queued_or_running{0};

    std::mutex m_progress_mutex;
    int m_progress_job_id{0};
    int m_progress_percent{0};
    std::string m_progress_text;

    // Slicing state (accessed exclusively on m_engine_thread)
    std::string m_resources_dir{"/resources"};
    std::string m_data_dir{"/data"};
    std::unique_ptr<Slic3r::PresetBundle> m_bundle;
    std::string m_selected_printer;
    std::string m_selected_process;
    std::vector<std::string> m_selected_filaments;
    Slic3r::DynamicPrintConfig m_options_override;
    Slic3r::Model m_model;
    Slic3r::Model m_clipboard;
    Slic3r::PlateDataPtrs m_plate_data;
    Slic3r::Calib_Params m_calib_params;
};

Engine::Impl::Impl() {
    m_engine_thread = std::thread(&Impl::worker_thread_loop, this);
}

Engine::Impl::~Impl() {
    cancel();
    {
        std::lock_guard<std::mutex> lock(m_queue_mutex);
        m_stop = true;
    }
    m_cv.notify_one();
    if (m_engine_thread.joinable()) {
        m_engine_thread.join();
    }
    Slic3r::release_PlateData_list(m_plate_data);
}

int Engine::Impl::submit(const std::string& op, const std::string& argsJson) {
    int id = m_next_job_id.fetch_add(1);
    if (op == "slice") {
        std::lock_guard<std::mutex> lock(m_cancel_mutex);
        m_slice_jobs_queued_or_running++;
    }
    {
        std::lock_guard<std::mutex> lock(m_queue_mutex);
        m_queue.push_back({id, op, argsJson});
    }
    m_cv.notify_one();
    return id;
}

std::string Engine::Impl::poll(int jobId) {
    std::lock_guard<std::mutex> lock(m_results_mutex);
    auto it = m_results.find(jobId);
    if (it == m_results.end()) {
        return "";
    }
    std::string res = std::move(it->second);
    m_results.erase(it);
    return res;
}

std::string Engine::Impl::progress() {
    std::lock_guard<std::mutex> lock(m_progress_mutex);
    if (m_progress_job_id > 0) {
        return json{
            {"jobId", m_progress_job_id},
            {"percent", m_progress_percent},
            {"text", m_progress_text}
        }.dump();
    }
    return json{{"jobId", 0}}.dump();
}

void Engine::Impl::cancel() {
    std::lock_guard<std::mutex> lock(m_cancel_mutex);
    if (m_current_print) {
        m_current_print->cancel();
    } else if (m_slice_jobs_queued_or_running > 0) {
        m_cancel_requested = true;
    }
}

void Engine::Impl::worker_thread_loop() {
    Slic3r::save_main_thread_id();
    while (true) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(m_queue_mutex);
            m_cv.wait(lock, [this] { return m_stop || !m_queue.empty(); });
            if (m_stop && m_queue.empty()) {
                break;
            }
            if (m_queue.empty()) {
                continue;
            }
            job = std::move(m_queue.front());
            m_queue.pop_front();
        }

        std::string result = execute_job(job.id, job.op, job.argsJson);
        {
            std::lock_guard<std::mutex> lock(m_results_mutex);
            m_results[job.id] = std::move(result);
        }
    }
}

std::string Engine::Impl::execute_job(int jobId, const std::string& op, const std::string& argsJson) {
    try {
        json args = json::object();
        if (!argsJson.empty()) {
            args = json::parse(argsJson);
        }
        if (op == "slice") {
            return op_slice(jobId, args);
        }

        json result_data;
        if (op == "init") {
            result_data = op_init(args);
        } else if (op == "loadVendors") {
            result_data = op_loadVendors(args);
        } else if (op == "listPresets") {
            result_data = op_listPresets(args);
        } else if (op == "getCompatiblePresets") {
            result_data = op_getCompatiblePresets(args);
        } else if (op == "selectPresets") {
            result_data = op_selectPresets(args);
        } else if (op == "removeFilamentSlot") {
            result_data = op_removeFilamentSlot(args);
        } else if (op == "getWipeTowerPreview") {
            result_data = op_getWipeTowerPreview(args);
        } else if (op == "getConfig") {
            result_data = op_getConfig(args);
        } else if (op == "mergeFilamentPresets") {
            result_data = op_mergeFilamentPresets(args);
        } else if (op == "getPresetConfig") {
            result_data = op_getPresetConfig(args);
        } else if (op == "getConfigDef") {
            result_data = op_getConfigDef(args);
        } else if (op == "evaluateRules") {
            result_data = op_evaluateRules(args);
        } else if (op == "setOptions") {
            result_data = op_setOptions(args);
        } else if (op == "normalizeOptions") {
            result_data = op_normalizeOptions(args);
        } else if (op == "resolvePreset") {
            result_data = op_resolvePreset(args);
        } else if (op == "setOption") {
            result_data = op_setOption(args);
        } else if (op == "getOption") {
            result_data = op_getOption(args);
        } else if (op == "resetOptions") {
            result_data = op_resetOptions(args);
        } else if (op == "loadModel") {
            result_data = op_loadModel(args);
        } else if (op == "addModel") {
            result_data = op_addModel(args);
        } else if (op == "loadStepMesh") {
            result_data = op_loadStepMesh(args);
        } else if (op == "listObjects") {
            result_data = op_listObjects(args);
        } else if (op == "getMesh") {
            result_data = op_getMesh(args);
        } else if (op == "getVolume") {
            result_data = OrcaWasm::getVolume(m_model, args);
        } else if (op == "setVolumeTransform") {
            result_data = OrcaWasm::setVolumeTransform(m_model, args);
        } else if (op == "setInstanceTransform") {
            result_data = op_setInstanceTransform(args);
        } else if (op == "deleteInstances") {
            result_data = OrcaWasm::deleteInstances(m_model, args);
        } else if (op == "deleteObject") {
            result_data = op_deleteObject(args);
        } else if (op == "moveObject") {
            result_data = op_moveObject(args);
        } else if (op == "duplicateInstance") {
            result_data = op_duplicateInstance(args);
        } else if (op == "mirrorInstance") {
            result_data = op_mirrorInstance(args);
        } else if (op == "copySelection") {
            result_data = op_copySelection(args);
        } else if (op == "pasteSelection") {
            result_data = op_pasteSelection(args);
        } else if (op == "cloneObject") {
            result_data = op_cloneObject(args);
        } else if (op == "exportModel") {
            result_data = op_exportModel(args);
        } else if (op == "placeObjects") {
            result_data = op_placeObjects(args);
        } else if (op == "arrange") {
            result_data = op_arrange(args);
        } else if (op == "openProject") {
            result_data = op_openProject(args);
        } else if (op == "saveProject") {
            result_data = op_saveProject(args);
        } else if (op == "getObjectTree") {
            result_data = op_getObjectTree(args);
        } else if (op == "addVolume") {
            result_data = op_addVolume(args);
        } else if (op == "moveVolume") {
            result_data = op_moveVolume(args);
        } else if (op == "deleteVolume") {
            result_data = op_deleteVolume(args);
        } else if (op == "renameObject") {
            result_data = op_renameObject(args);
        } else if (op == "renameVolume") {
            result_data = op_renameVolume(args);
        } else if (op == "setObjectConfig") {
            result_data = op_setObjectConfig(args);
        } else if (op == "resetObjectConfig") {
            result_data = op_resetObjectConfig(args);
        } else if (op == "setVolumeExtruder") {
            result_data = op_setVolumeExtruder(args);
        } else if (op == "mergeObjects") {
            result_data = op_mergeObjects(args);
        } else if (op == "setVolumeType") {
            result_data = op_setVolumeType(args);
        } else if (op == "getMeasurementFeature") {
            result_data = OrcaWasm::getMeasurementFeature(m_model, args);
        } else if (op == "measureFeatures") {
            result_data = OrcaWasm::measureFeatures(args);
        } else if (op == "listPlates") {
            result_data = op_listPlates(args);
        } else if (op == "duplicatePlate") {
            result_data = op_duplicatePlate(args);
        } else if (op == "addPlate") {
            result_data = op_addPlate(args);
        } else if (op == "deletePlate") {
            result_data = op_deletePlate(args);
        } else if (op == "setPlateConfig") {
            result_data = op_setPlateConfig(args);
        } else if (op == "getSupportPainting") {
            result_data = op_getSupportPainting(args);
        } else if (op == "setSupportPainting") {
            result_data = op_setSupportPainting(args);
        } else if (op == "clearSupportPainting") {
            result_data = op_clearSupportPainting(args);
        } else if (op == "getSeamPainting") {
            result_data = op_getSeamPainting(args);
        } else if (op == "setSeamPainting") {
            result_data = op_setSeamPainting(args);
        } else if (op == "clearSeamPainting") {
            result_data = op_clearSeamPainting(args);
        } else if (op == "parsePreset") {
            result_data = op_parsePreset(args);
        } else if (op == "setupCalibration") {
            result_data = op_setupCalibration(args);
        } else if (op == "cutObject") {
            result_data = op_cutObject(args);
        } else if (op == "cutObjectWithConnectors") {
            result_data = op_cutObjectWithConnectors(args);
        } else if (op == "getMeshHealth") {
            result_data = op_getMeshHealth(args);
        } else if (op == "checkMeshHealth") {
            result_data = op_checkMeshHealth(args);
        } else if (op == "repairObject") {
            result_data = op_repairObject(args);
        } else if (op == "repairMesh") {
            result_data = op_repairMesh(args);
        } else if (op == "paintStroke") {
            result_data = op_paintStroke(args);
        } else if (op == "getPaintOverlay") {
            result_data = op_getPaintOverlay(args);
        } else if (op == "getPaintData") {
            result_data = op_getPaintData(args);
        } else if (op == "setPaintData") {
            result_data = op_setPaintData(args);
        } else if (op == "clearPaint") {
            result_data = op_clearPaint(args);
        } else if (op == "getLayerHeightProfile") {
            result_data = op_getLayerHeightProfile(args);
        } else if (op == "setLayerHeightProfile") {
            result_data = op_setLayerHeightProfile(args);
        } else if (op == "adaptiveLayerHeights") {
            result_data = op_adaptiveLayerHeights(args);
        } else if (op == "smoothLayerHeights") {
            result_data = op_smoothLayerHeights(args);
        } else if (op == "adjustLayerHeights") {
            result_data = op_adjustLayerHeights(args);
        } else if (op == "resetLayerHeights") {
            result_data = op_resetLayerHeights(args);
        } else if (op == "getObjectLayers") {
            result_data = op_getObjectLayers(args);

        } else if (op == "autoOrient") { result_data = op_autoOrient(args);
        } else if (op == "getPlanarFacets") { result_data = op_getPlanarFacets(args);
        } else if (op == "placeOnFace") { result_data = op_placeOnFace(args);
        } else if (op == "splitObject") { result_data = op_splitObject(args);
        } else if (op == "splitVolume") { result_data = op_splitVolume(args);
        } else if (op == "simplifyVolume") { result_data = op_simplifyVolume(args);
        } else if (op == "meshBoolean") { result_data = op_meshBoolean(args);
        } else if (op == "addSvg") { result_data = op_addSvg(args);
        } else if (op == "updateSvg") { result_data = op_updateSvg(args);
        } else if (op == "getSvg") { result_data = op_getSvg(args);
        } else if (op == "getBrimEars") { result_data = op_getBrimEars(args);
        } else if (op == "setBrimEars") { result_data = op_setBrimEars(args);
        } else if (op == "clearBrimEars") { result_data = op_clearBrimEars(args);
} else if (op == "addText") {
            result_data = op_addText(args);
        } else if (op == "updateText") {
            result_data = op_updateText(args);
        } else if (op == "getText") {
            result_data = op_getText(args);
        } else if (op == "getLayerEvents") {
            result_data = op_getLayerEvents(args);
        } else if (op == "setLayerEvents") {
            result_data = op_setLayerEvents(args);
        } else if (op == "clearLayerEvents") {
            result_data = op_clearLayerEvents(args);
        } else {
            throw Slic3r::RuntimeError("Unknown operation: " + op);
        }
        return json{{"ok", true}, {"result", result_data}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    } catch (...) {
        return json{{"ok", false}, {"error", "Unknown exception"}}.dump();
    }
}

json Engine::Impl::op_init(const json& args) {
    if (args.contains("resourcesDir") && args["resourcesDir"].is_string()) {
        m_resources_dir = args["resourcesDir"].get<std::string>();
    }
    if (args.contains("dataDir") && args["dataDir"].is_string()) {
        m_data_dir = args["dataDir"].get<std::string>();
    }

    Slic3r::set_resources_dir(m_resources_dir);
    Slic3r::set_data_dir(m_data_dir);
    Slic3r::set_var_dir((std::filesystem::path(m_resources_dir) / "images").string());
    Slic3r::set_sys_shapes_dir((std::filesystem::path(m_resources_dir) / "shapes").string());
    Slic3r::set_custom_gcodes_dir((std::filesystem::path(m_resources_dir) / "custom_gcodes").string());

    boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::warning);

    return json::object();
}

json Engine::Impl::op_loadVendors(const json& args) {
    std::string prev_printer = m_selected_printer;
    std::string prev_process = m_selected_process;
    std::vector<std::string> prev_filaments = m_selected_filaments;

    m_bundle = std::make_unique<Slic3r::PresetBundle>();
    Slic3r::AppConfig app_config;
    m_bundle->load_presets(app_config, Slic3r::ForwardCompatibilitySubstitutionRule::EnableSilent,
                           Slic3r::PresetBundle::PresetPreferences(), nullptr, true);
    m_bundle->normalize_compatible_presets();
    m_bundle->update_multi_material_filament_presets();
    m_bundle->update_compatible(Slic3r::PresetSelectCompatibleType::Never);
    m_bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(Slic3r::btPC));

    for (auto& p : m_bundle->printers) p.is_visible = true;
    for (auto& p : m_bundle->prints) p.is_visible = true;
    for (auto& p : m_bundle->filaments) p.is_visible = true;

    if (!prev_printer.empty() && m_bundle->printers.find_preset(prev_printer) != nullptr) {
        m_bundle->printers.select_preset_by_name(prev_printer, true);
        m_selected_printer = prev_printer;
    } else {
        m_selected_printer.clear();
    }

    if (!prev_process.empty() && m_bundle->prints.find_preset(prev_process) != nullptr) {
        m_bundle->prints.select_preset_by_name(prev_process, true);
        m_selected_process = prev_process;
    } else {
        m_selected_process.clear();
    }

    bool all_filaments_exist = !prev_filaments.empty();
    for (const auto& f : prev_filaments) {
        if (m_bundle->filaments.find_preset(f) == nullptr) {
            all_filaments_exist = false;
            break;
        }
    }
    if (all_filaments_exist) {
        m_bundle->set_num_filaments(static_cast<unsigned int>(prev_filaments.size()));
        m_bundle->filament_presets = prev_filaments;
        m_bundle->filaments.select_preset_by_name(prev_filaments[0], true);
        for (size_t i = 0; i < prev_filaments.size(); ++i) {
            if (const auto* p = m_bundle->filaments.find_preset(prev_filaments[i], false)) {
                if (p->config.has("filament_colour") && !p->config.opt_string("filament_colour").empty()) {
                    m_bundle->project_config.option<Slic3r::ConfigOptionStrings>("filament_colour")->values[i] = p->config.opt_string("filament_colour");
                    m_bundle->project_config.option<Slic3r::ConfigOptionStrings>("filament_multi_colour")->values[i] = p->config.opt_string("filament_colour");
                }
            }
        }
        m_selected_filaments = prev_filaments;
    } else {
        m_selected_filaments.clear();
    }

    if (!m_selected_printer.empty()) {
        if (m_bundle->printers.get_edited_preset().printer_technology() == Slic3r::ptFFF) {
            if (m_bundle->printers.get_edited_preset().config.has("default_bed_type") &&
                !m_bundle->printers.get_edited_preset().config.opt_string("default_bed_type").empty()) {
                Slic3r::BedType bed_type = m_bundle->printers.get_edited_preset().get_default_bed_type(m_bundle.get());
                m_bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(bed_type));
            } else {
                m_bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(Slic3r::btPC));
            }
        }
        m_bundle->update_multi_material_filament_presets();
        m_bundle->update_compatible(Slic3r::PresetSelectCompatibleType::Never);
    }

    json vendors_arr = json::array();
    for (const auto& [vname, vprofile] : m_bundle->vendors) {
        size_t printers_cnt = 0;
        for (const auto& p : m_bundle->printers) {
            auto vp = m_bundle->printers.get_preset_with_vendor_profile(p);
            if (vp.vendor && (vp.vendor->name == vname || vp.vendor->id == vname))
                printers_cnt++;
        }
        size_t processes_cnt = 0;
        for (const auto& p : m_bundle->prints) {
            auto vp = m_bundle->prints.get_preset_with_vendor_profile(p);
            if (vp.vendor && (vp.vendor->name == vname || vp.vendor->id == vname))
                processes_cnt++;
        }
        size_t filaments_cnt = 0;
        for (const auto& p : m_bundle->filaments) {
            auto vp = m_bundle->filaments.get_preset_with_vendor_profile(p);
            if (vp.vendor && (vp.vendor->name == vname || vp.vendor->id == vname))
                filaments_cnt++;
        }
        vendors_arr.push_back({
            {"name", vname},
            {"printers", printers_cnt},
            {"processes", processes_cnt},
            {"filaments", filaments_cnt}
        });
    }

    return json{{"vendors", vendors_arr}};
}

json Engine::Impl::op_listPresets(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    std::string kind = args.at("kind").get<std::string>();
    bool compatibleOnly = args.value("compatibleOnly", false);

    Slic3r::PresetCollection* collection = nullptr;
    if (kind == "printer") collection = &m_bundle->printers;
    else if (kind == "process") collection = &m_bundle->prints;
    else if (kind == "filament") collection = &m_bundle->filaments;
    else throw Slic3r::RuntimeError("Unknown preset kind: " + kind);

    json list = json::array();
    for (const auto& p : *collection) {
        if (compatibleOnly && !p.is_compatible) continue;
        auto vp = collection->get_preset_with_vendor_profile(p);
        std::string vname = (vp.vendor ? (vp.vendor->name.empty() ? vp.vendor->id : vp.vendor->name) : "");
        list.push_back({
            {"name", p.name},
            {"vendor", vname},
            {"isSystem", p.is_system},
            {"isCompatible", p.is_compatible},
            {"inherits", p.inherits()}
        });
    }
    return list;
}

namespace {

void apply_json_values_to_config(Slic3r::DynamicPrintConfig& config, const json& values) {
    if (!values.is_object()) return;
    json errors = json::array();
    const auto normalized = normalize_options(values, errors);
    if (has_fatal_errors(errors)) throw Slic3r::RuntimeError("Invalid preset overrides: " + errors.dump());
    config.apply(normalized);
}

} // namespace

json Engine::Impl::op_getCompatiblePresets(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");

    std::string printer = args.at("printer").get<std::string>();
    std::string printer_name = args.value("printerName", printer);

    if (m_bundle->printers.find_preset(printer) == nullptr)
        throw Slic3r::RuntimeError("Unknown printer preset: " + printer);

    // Make an isolated copy of m_bundle so current selection and compatibility state remain unchanged.
    Slic3r::PresetBundle temp_bundle(*m_bundle);
    if (!temp_bundle.printers.select_preset_by_name(printer, true))
        throw Slic3r::RuntimeError("Failed to select printer: " + printer);

    Slic3r::Preset& active_printer = temp_bundle.printers.get_edited_preset();
    if (printer_name != printer) {
        active_printer.name = printer_name;
        active_printer.inherits() = printer;
        active_printer.is_system = false;
        active_printer.is_default = false;
    }

    if (args.contains("printerOverrides") && args["printerOverrides"].is_object()) {
        apply_json_values_to_config(active_printer.config, args["printerOverrides"]);
    }

    temp_bundle.update_compatible(Slic3r::PresetSelectCompatibleType::Always);

    json comp_processes = json::array();
    for (const auto& p : temp_bundle.prints) {
        if (p.is_compatible) comp_processes.push_back(p.name);
    }

    json comp_filaments = json::array();
    for (const auto& f : temp_bundle.filaments) {
        if (f.is_compatible) comp_filaments.push_back(f.name);
    }

    const Slic3r::PresetWithVendorProfile active_printer_with_vendor =
        temp_bundle.printers.get_preset_with_vendor_profile(active_printer);

    Slic3r::DynamicPrintConfig extra_config;
    extra_config.set_key_value("printer_preset", new Slic3r::ConfigOptionString(active_printer.name));
    const Slic3r::ConfigOption* opt = active_printer.config.option("nozzle_diameter");
    if (opt) {
        extra_config.set_key_value("num_extruders",
            new Slic3r::ConfigOptionInt(static_cast<int>(static_cast<const Slic3r::ConfigOptionFloats*>(opt)->values.size())));
    }

    json comp_user_presets = json::array();
    if (args.contains("userPresets") && args["userPresets"].is_array()) {
        for (const auto& up : args["userPresets"]) {
            std::string uname = up.value("name", "");
            std::string ukind = up.value("kind", "");
            std::string uinherits = up.value("inherits", "");
            if (uname.empty() || ukind.empty()) continue;

            const Slic3r::Preset* parent = nullptr;
            Slic3r::PresetCollection* collection = nullptr;
            if (ukind == "process") {
                collection = &temp_bundle.prints;
            } else if (ukind == "filament") {
                collection = &temp_bundle.filaments;
            }
            if (!collection) continue;

            if (!uinherits.empty()) {
                parent = collection->find_preset2(uinherits, true);
            }

            bool has_custom_compat = false;
            if (up.contains("values") && up["values"].is_object()) {
                const auto& vals = up["values"];
                if (vals.contains("compatible_printers") || vals.contains("compatible_printers_condition")) {
                    has_custom_compat = true;
                }
            }

            if (!has_custom_compat) {
                // Desktop does not load a user preset whose parent is missing, so it is never exported.
                if (parent ? parent->is_compatible : uinherits.empty())
                    comp_user_presets.push_back(uname);
            } else {
                Slic3r::Preset custom_preset(ukind == "process" ? Slic3r::Preset::TYPE_PRINT : Slic3r::Preset::TYPE_FILAMENT, uname);
                if (parent) {
                    custom_preset = *parent;
                }
                custom_preset.name = uname;
                custom_preset.is_system = false;
                custom_preset.is_default = false;
                if (!uinherits.empty()) {
                    custom_preset.inherits() = uinherits;
                }

                if (up.contains("values") && up["values"].is_object()) {
                    apply_json_values_to_config(custom_preset.config, up["values"]);
                }

                const Slic3r::PresetWithVendorProfile custom_with_vendor(custom_preset, parent ? parent->vendor : nullptr);
                bool compat = Slic3r::is_compatible_with_printer(custom_with_vendor, active_printer_with_vendor, &extra_config);
                if (compat && ukind == "filament" && temp_bundle.prints.get_selected_idx() != size_t(-1)) {
                    const Slic3r::PresetWithVendorProfile print_with_vendor = temp_bundle.prints.get_edited_preset_with_vendor_profile();
                    compat = Slic3r::is_compatible_with_print(custom_with_vendor, print_with_vendor, active_printer_with_vendor);
                }
                if (compat) {
                    comp_user_presets.push_back(uname);
                }
            }
        }
    }

    return json{
        {"compatibleUserPresets", comp_user_presets},
        {"compatibleProcesses", comp_processes},
        {"compatibleFilaments", comp_filaments}
    };
}

json Engine::Impl::op_selectPresets(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    std::string printer_name = args.at("printer").get<std::string>();
    std::string process_name = args.at("process").get<std::string>();
    std::vector<std::string> filament_names = args.at("filaments").get<std::vector<std::string>>();

    if (m_bundle->printers.find_preset(printer_name) == nullptr)
        throw Slic3r::RuntimeError("Unknown printer preset: " + printer_name);
    if (m_bundle->prints.find_preset(process_name) == nullptr)
        throw Slic3r::RuntimeError("Unknown process preset: " + process_name);
    if (filament_names.empty())
        throw Slic3r::RuntimeError("No filaments specified");
    for (auto& f : filament_names) {
        const auto* preset = m_bundle->filaments.find_preset(f);
        if (preset == nullptr)
            throw Slic3r::RuntimeError("Unknown filament preset: " + f);
        f = preset->name;
    }

    m_options_override.clear();

    if (auto* pr = m_bundle->printers.find_preset(printer_name)) pr->is_visible = true;
    if (auto* proc = m_bundle->prints.find_preset(process_name)) proc->is_visible = true;
    for (const auto& f : filament_names) {
        if (auto* fil = m_bundle->filaments.find_preset(f)) fil->is_visible = true;
    }
    m_bundle->printers.select_preset_by_name(printer_name, true);
    m_selected_printer = m_bundle->printers.get_edited_preset().name;

    if (m_bundle->printers.get_edited_preset().printer_technology() == Slic3r::ptFFF) {
        if (m_bundle->printers.get_edited_preset().config.has("default_bed_type") &&
            !m_bundle->printers.get_edited_preset().config.opt_string("default_bed_type").empty()) {
            Slic3r::BedType bed_type = m_bundle->printers.get_edited_preset().get_default_bed_type(m_bundle.get());
            m_bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(bed_type));
        } else {
            m_bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(Slic3r::btPC));
        }
    }

    m_bundle->prints.select_preset_by_name(process_name, true);
    m_selected_process = m_bundle->prints.get_edited_preset().name;

    m_bundle->set_num_filaments(static_cast<unsigned int>(filament_names.size()));
    m_bundle->filament_presets = filament_names;
    m_bundle->filaments.select_preset_by_name(filament_names[0], true);
    for (size_t i = 0; i < filament_names.size(); ++i) {
        if (const auto* p = m_bundle->filaments.find_preset(filament_names[i], false)) {
            if (p->config.has("filament_colour") && !p->config.opt_string("filament_colour").empty()) {
                m_bundle->project_config.option<Slic3r::ConfigOptionStrings>("filament_colour")->values[i] = p->config.opt_string("filament_colour");
                m_bundle->project_config.option<Slic3r::ConfigOptionStrings>("filament_multi_colour")->values[i] = p->config.opt_string("filament_colour");
            }
        }
    }

    m_bundle->update_multi_material_filament_presets();
    m_bundle->update_compatible(Slic3r::PresetSelectCompatibleType::Never);

    m_selected_filaments = m_bundle->filament_presets;

    return json{
        {"printer", m_selected_printer},
        {"process", m_selected_process},
        {"filaments", m_selected_filaments}
    };
}

json Engine::Impl::op_removeFilamentSlot(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const size_t count = m_selected_filaments.size();
    if (!args.at("filamentIndex").is_number_integer() || args.at("filamentIndex").get<int64_t>() < 0)
        throw Slic3r::RuntimeError("Invalid filament index");
    const size_t slot = args.at("filamentIndex").get<size_t>();
    if (slot >= count || count <= 1 ||
        count > size_t(Slic3r::EnforcerBlockerType::ExtruderMax))
        throw Slic3r::RuntimeError("Cannot remove this filament slot");
    const auto& selection = args.at("selection");
    if (selection.at("filaments").size() != count - 1)
        throw Slic3r::RuntimeError("Invalid remaining filament count");
    const auto projected = op_resetOptions({{"filamentIndex", slot}, {"removeFilamentSlot", true},
                                           {"overrides", args.at("overrides")}}).at("filamentOverrides");

    // Stage geometry, painting and plate settings before touching live state.
    Slic3r::Model candidate(m_model);
    std::map<int, int> relocations;
    for (size_t i = slot; i < count; ++i) relocations.emplace(int(i), i == slot ? 0 : int(i - 1));
    Slic3r::remap_model_filament_slots(candidate, relocations);
    for (auto* object : candidate.objects) {
        remap_slot_selectors(object->config, slot);
        for (auto* volume : object->volumes) remap_slot_selectors(volume->config, slot);
        for (auto& range : object->layer_config_ranges) remap_slot_selectors(range.second, slot);
    }
    std::vector<std::unique_ptr<Slic3r::PlateData>> plates;
    Slic3r::PlateDataPtrs next_plates;
    next_plates.reserve(m_plate_data.size());
    for (const auto* plate : m_plate_data) {
        plates.emplace_back(std::make_unique<Slic3r::PlateData>(*plate));
        auto& next = *plates.back();
        next.config = project_removed_slot(plate->config, count, slot, false);
        if (!next.filament_maps.empty()) {
            if (next.filament_maps.size() != count) throw Slic3r::RuntimeError("Invalid plate filament map width");
            next.filament_maps.erase(next.filament_maps.begin() + slot);
        }
        next.is_sliced_valid = false;
        next_plates.push_back(&next);
    }
    auto staged_bundle = std::make_unique<Slic3r::PresetBundle>(*m_bundle);
    auto previous_options = m_options_override;
    auto previous_printer = m_selected_printer;
    auto previous_process = m_selected_process;
    auto previous_filaments = m_selected_filaments;
    auto previous_bundle = std::move(m_bundle);
    m_bundle = std::move(staged_bundle);
    try {
        // Feed effective project maps into desktop's existing slot deletion,
        // including its flush/mixed metadata handling, before selecting presets.
        json errors = json::array();
        const auto original = normalize_options(args.at("overrides"), errors);
        for (const auto& key : original.keys())
            if (is_slot_map(key)) m_bundle->project_config.set_key_value(key, original.option(key)->clone());
        m_bundle->update_num_filaments(unsigned(slot));
        remap_slot_selectors(m_bundle->project_config, slot);
        json result = op_selectPresets(selection);
        if (m_selected_filaments.size() != count - 1) throw Slic3r::RuntimeError("Native filament count changed");
        json options = op_mergeFilamentPresets({{"slots", args.at("slots")}});
        for (const auto& [key, value] : args.at("baselineOverrides").items()) options[key] = value;
        const auto baseline_applied = op_setOptions({{"options", options}});
        if (has_fatal_errors(baseline_applied.at("errors"))) throw Slic3r::RuntimeError(baseline_applied.dump());
        result["baseline"] = op_getConfig(json::object());
        for (const auto& [key, value] : projected.items()) options[key] = value;
        const auto applied = op_setOptions({{"options", options}});
        if (has_fatal_errors(applied.at("errors"))) throw Slic3r::RuntimeError(applied.dump());
        result["overrides"] = projected;
        result["config"] = op_getConfig(json::object());
        result["rules"] = op_evaluateRules({{"kind", "print"}, {"filamentIndex", args.value("activeFilamentIndex", 0)}});
        // All validation, allocation, remapping and serialization succeeded.
        m_model = std::move(candidate);
        m_plate_data.swap(next_plates);
        for (auto& plate : plates) plate.release();
        for (auto* plate : next_plates) delete plate;
        return result;
    } catch (...) {
        m_bundle = std::move(previous_bundle);
        m_options_override = std::move(previous_options);
        m_selected_printer = std::move(previous_printer);
        m_selected_process = std::move(previous_process);
        m_selected_filaments = std::move(previous_filaments);
        throw;
    }
}

json Engine::Impl::op_getWipeTowerPreview(const json& args) {
    if (!m_bundle) return {{"enabled", false}};
    auto config = m_bundle->full_config();
    config.apply(m_options_override);
    const size_t plate = static_cast<size_t>(std::max(0, args.value("plateIndex", 0)));
    if (plate < m_plate_data.size()) config.apply(m_plate_data[plate]->config);
    const auto* diameters = config.opt<Slic3r::ConfigOptionFloats>("filament_diameter");
    if (!config.opt_bool("enable_prime_tower") || !diameters || diameters->values.size() < 2) return {{"enabled", false}};
    // Configured filament slots alone do not require a tower. Only printable
    // geometry on this plate (including material painting) contributes tools.
    OrcaEngine::listPlates(m_model, m_plate_data, config);
    if (plate >= m_plate_data.size()) return {{"enabled", false}};
    std::set<int> object_indices;
    for (const auto& pair : m_plate_data[plate]->objects_and_instances) {
        const auto* object = m_model.objects[pair.first];
        if (object->printable && object->instances[pair.second]->printable)
            object_indices.insert(pair.first);
    }
    std::set<unsigned int> used_filaments;
    double height = 20.0;
    for (int index : object_indices) {
        const auto* object = m_model.objects[index];
        height = std::max(height, object->bounding_box_exact().size().z());
        for (const auto* volume : object->volumes) {
            for (int extruder : volume->get_extruders()) {
                const unsigned int filament = static_cast<unsigned int>(std::max(1, extruder) - 1);
                if (filament < diameters->values.size()) used_filaments.insert(filament);
            }
        }
    }
    if (used_filaments.size() < 2) return {{"enabled", false}};
    const std::vector<unsigned int> filaments(used_filaments.begin(), used_filaments.end());
    const auto footprint = Slic3r::estimate_wipe_tower_footprint(config, Slic3r::resolve_wipe_tower_type(config), filaments, config.opt_float("layer_height"), height);
    const auto coordinate = [&](const char* key, double fallback) {
        const auto* values = config.opt<Slic3r::ConfigOptionFloats>(key);
        return values && !values->values.empty() ? values->values[std::min(plate, values->values.size() - 1)] : fallback;
    };
    return {{"enabled", true}, {"width", footprint.width}, {"depth", footprint.depth}, {"height", footprint.height},
            {"brim", footprint.brim_width}, {"x", coordinate("wipe_tower_x", 165.0)}, {"y", coordinate("wipe_tower_y", 250.0)},
            {"rotation", config.opt_float("wipe_tower_rotation_angle")}};
}

json Engine::Impl::op_getConfig(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    if (config.opt_string("before_layer_change_gcode").empty() && config.opt_string("layer_change_gcode").empty()) {
        config.set_key_value("before_layer_change_gcode", new Slic3r::ConfigOptionString("G92 E0"));
    }

    json res = json::object();
    const auto& filament_keys = Slic3r::Preset::filament_options();
    const bool project_slot = args.contains("filamentIndex") && !args.at("filamentIndex").is_null();
    if (project_slot) {
        if (!args.at("filamentIndex").is_number_integer() || args.at("filamentIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid filament index");
        }
    }
    const size_t slot = project_slot ? args.at("filamentIndex").get<size_t>() : 0;
    const auto* colours = config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    const size_t count = colours ? colours->values.size() : m_selected_filaments.size();
    if (project_slot && slot >= count) throw Slic3r::RuntimeError("Invalid filament index");
    for (const std::string& key : config.keys()) {
        if (!project_slot) {
            res[key] = config.opt_serialize(key);
            continue;
        }
        if (key != "filament_colour" && std::find(filament_keys.begin(), filament_keys.end(), key) == filament_keys.end()) continue;
        if (args.contains("keys") && std::find(args.at("keys").begin(), args.at("keys").end(), key) == args.at("keys").end()) continue;
        const auto* source = config.option(key);
        std::unique_ptr<Slic3r::ConfigOption> value(source->clone());
        if (const auto* vector = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(source)) {
            // Keep each filament's complete nozzle-variant stride and native string escaping.
            const size_t stride = vector->size() >= count && vector->size() % count == 0 ? vector->size() / count : vector->size();
            const size_t start = vector->size() >= count && vector->size() % count == 0 ? slot * stride : 0;
            static_cast<Slic3r::ConfigOptionVectorBase*>(value.get())->set(source, start, stride);
        }
        res[key] = value->serialize();
    }
    return res;
}

// The options of one preset as stored, without selecting it, so presets can be compared with the active one.
json Engine::Impl::op_getPresetConfig(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    const std::string kind = args.at("kind").get<std::string>();
    const std::string name = args.at("name").get<std::string>();

    Slic3r::PresetCollection* collection = nullptr;
    if (kind == "printer") collection = &m_bundle->printers;
    else if (kind == "process") collection = &m_bundle->prints;
    else if (kind == "filament") collection = &m_bundle->filaments;
    else throw Slic3r::RuntimeError("Unknown preset kind: " + kind);

    const Slic3r::Preset* preset = collection->find_preset(name, false);
    if (!preset) throw Slic3r::RuntimeError("Unknown " + kind + " preset: " + name);

    json res = json::object();
    for (const std::string& key : preset->config.keys()) res[key] = preset->config.opt_serialize(key);
    return res;
}

// Use desktop's multi-filament merge, including per-extruder vector strides.
json Engine::Impl::op_mergeFilamentPresets(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const auto& slots = args.at("slots");
    if (!slots.is_array() || slots.empty() || slots.size() > 16)
        throw Slic3r::RuntimeError("Expected 1 to 16 filament slots");
    std::vector<Slic3r::Preset> presets;
    std::set<std::string> changed_keys;
    const auto& allowed = Slic3r::Preset::filament_options();
    for (const auto& slot : slots) {
        const auto name = slot.at("preset").get<std::string>();
        const auto* base = m_bundle->filaments.find_preset(name, false);
        if (!base) throw Slic3r::RuntimeError("Unknown filament preset: " + name);
        presets.push_back(*base);
        if (!slot.contains("values")) continue;
        if (!slot["values"].is_object()) throw Slic3r::RuntimeError("Filament overrides must be an object");
        for (const auto& [key, value] : slot["values"].items()) {
            const auto* definition = Slic3r::print_config_def.get(key);
            if (!definition) continue;
            if (key != "filament_colour" && std::find(allowed.begin(), allowed.end(), key) == allowed.end())
                throw Slic3r::RuntimeError("Not a filament option: " + key);
            std::unique_ptr<Slic3r::ConfigOption> option(definition->create_empty_option());
            if (!valid_numeric_option(*option, value.get<std::string>()))
                throw Slic3r::RuntimeError("Invalid filament option value: " + key);
            presets.back().config.set_deserialize_strict(key, value.get<std::string>());
            changed_keys.insert(key);
        }
    }
    // Colours belong to the project, but user filament presets may supply a colour.
    // Include it in every slot so the desktop vector merge can collect it safely.
    if (changed_keys.count("filament_colour")) {
        const auto* colours = m_bundle->project_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
        for (size_t i = 0; i < presets.size(); ++i) {
            if (!presets[i].config.has("filament_colour")) {
                const std::string colour = colours && !colours->values.empty()
                    ? colours->values[std::min(i, colours->values.size() - 1)] : "#FFFFFF";
                presets[i].config.set_deserialize_strict("filament_colour", colour);
            }
        }
    }
    auto printer = m_bundle->printers.get_edited_preset();
    auto process = m_bundle->prints.get_edited_preset();
    const auto config = Slic3r::PresetBundle::construct_full_config(
        printer, process, m_bundle->project_config, presets, true, std::nullopt);
    json result = json::object();
    for (const auto& key : changed_keys) {
        if (config.has(key)) result[key] = config.opt_serialize(key);
    }
    return result;
}

json Engine::Impl::op_getConfigDef(const json& args) {
    json res = json::object();
    if (args.contains("keys") && args["keys"].is_array()) {
        for (const auto& item : args["keys"]) {
            if (item.is_string()) {
                const std::string key = item.get<std::string>();
                const Slic3r::ConfigOptionDef* def = Slic3r::print_config_def.get(key);
                if (def != nullptr) {
                    res[key] = serialize_option_def(*def);
                }
            }
        }
    } else {
        for (const auto& kv : Slic3r::print_config_def.options) {
            res[kv.first] = serialize_option_def(kv.second);
        }
    }
    return res;
}

json Engine::Impl::op_evaluateRules(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");

    std::string kind;
    if (args.contains("kind") && args["kind"].is_string()) {
        kind = args["kind"].get<std::string>();
    } else {
        throw Slic3r::RuntimeError("evaluateRules requires 'kind' argument");
    }

    int filament_index = 0;
    if (args.contains("filamentIndex") && args["filamentIndex"].is_number()) {
        filament_index = args["filamentIndex"].get<int>();
    }

    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    if (config.opt_string("before_layer_change_gcode").empty() && config.opt_string("layer_change_gcode").empty()) {
        config.set_key_value("before_layer_change_gcode", new Slic3r::ConfigOptionString("G92 E0"));
    }

    OrcaWeb::RuleContext context;
    context.is_bbl_printer = m_bundle->is_bbl_vendor();

    if (config.has("nozzle_diameter")) {
        const auto* nd = config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter");
        if (nd && !nd->values.empty()) {
            context.extruders_count = static_cast<int>(nd->values.size());
        }
    }

    // Match desktop ConfigManipulation.cpp:515: wxGetApp().preset_bundle->filament_presets.size()
    context.filament_cnt = std::max<int>(1, static_cast<int>(m_bundle->filament_presets.size()));

    if (config.has("printer_model")) {
        context.printer_model = config.opt_string("printer_model");
    } else {
        context.printer_model = m_bundle->printers.get_edited_preset().config.opt_string("printer_model");
    }

    context.support_chamber_temp_control = config.has("support_chamber_temp_control") && config.opt_bool("support_chamber_temp_control");

    bool gcf_is_marlin = config.has("gcode_flavor") && config.option<Slic3r::ConfigOptionEnum<Slic3r::GCodeFlavor>>("gcode_flavor")->value == Slic3r::GCodeFlavor::gcfMarlinFirmware;
    if (gcf_is_marlin) {
        if (const auto* machine_jd = config.option<Slic3r::ConfigOptionFloats>("machine_max_junction_deviation")) {
            context.machine_supports_junction_deviation = !machine_jd->values.empty() && machine_jd->values.front() > 0.0;
        }
    }

    context.single_extruder_multi_material = config.has("single_extruder_multi_material") && config.opt_bool("single_extruder_multi_material");
    context.supports_wipe_tower_2 = !context.is_bbl_printer && config.has("wipe_tower_type") &&
        config.opt_enum<Slic3r::WipeTowerType>("wipe_tower_type") == Slic3r::WipeTowerType::Type2;
    context.purge_in_prime_tower = config.has("purge_in_prime_tower") && config.opt_bool("purge_in_prime_tower");
    context.support_parallel_printheads = config.has("support_parallel_printheads") && config.opt_bool("support_parallel_printheads");
    context.support_multi_bed_types = config.has("support_multi_bed_types") && config.opt_bool("support_multi_bed_types");

    if (config.has("curr_bed_type")) {
        context.curr_bed_type = static_cast<int>(config.opt_enum<Slic3r::BedType>("curr_bed_type"));
    } else if (m_bundle->project_config.has("curr_bed_type")) {
        context.curr_bed_type = static_cast<int>(m_bundle->project_config.opt_enum<Slic3r::BedType>("curr_bed_type"));
    } else {
        context.curr_bed_type = -1;
    }

    for (int i = 0; i < context.filament_cnt; ++i) {
        context.is_mixed_filament.push_back(m_bundle->is_mixed_filament(static_cast<size_t>(i)));
    }

    if (config.has("min_layer_height") && config.has("max_layer_height")) {
        const auto* min_opt = config.option<Slic3r::ConfigOptionFloats>("min_layer_height");
        const auto* max_opt = config.option<Slic3r::ConfigOptionFloats>("max_layer_height");
        if (min_opt && !min_opt->values.empty() && max_opt && !max_opt->values.empty()) {
            context.min_layer_height = *std::min_element(min_opt->values.begin(), min_opt->values.end());
            context.max_layer_height = *std::max_element(max_opt->values.begin(), max_opt->values.end());
        }
    }

    context.variant_index = filament_index;
    context.is_global_config = true;
    context.is_plate_config = false;

    for (const auto* obj : m_model.objects) {
        if (obj && obj->layer_height_profile.get().size() > 4) {
            context.has_variable_layer_height = true;
            break;
        }
    }

    OrcaWeb::RuleResult rule_result;
    if (kind == "print") {
        rule_result = OrcaWeb::evaluate_print_rules(config, context);
    } else if (kind == "printer") {
        rule_result = OrcaWeb::evaluate_printer_rules(config, context);
    } else if (kind == "filament") {
        rule_result = OrcaWeb::evaluate_filament_rules(config, context);
    } else if (kind == "sla_print") {
        rule_result = OrcaWeb::evaluate_sla_print_rules(config, context);
    } else if (kind == "sla_material") {
        rule_result = OrcaWeb::evaluate_sla_material_rules(config, context);
    } else {
        throw Slic3r::RuntimeError("Unknown rule kind: " + kind);
    }

    json fields_json = json::object();
    for (const auto& [k, state] : rule_result.fields) {
        json f = {
            {"enabled", state.enabled},
            {"visible", state.visible}
        };
        if (!state.label.empty()) {
            f["label"] = state.label;
        }
        fields_json[k] = f;
    }

    json fixes_json = json::array();
    for (const auto& fix : rule_result.fixes) {
        fixes_json.push_back({
            {"key", fix.key},
            {"value", fix.value},
            {"reason", fix.reason}
        });
    }

    json messages_json = json::array();
    for (const auto& msg : rule_result.messages) {
        messages_json.push_back(msg);
    }

    json is_mixed_arr = json::array();
    for (bool b : context.is_mixed_filament) {
        is_mixed_arr.push_back(b);
    }

    json context_json = {
        {"is_bbl_printer", context.is_bbl_printer},
        {"support_wrapping_detection", context.support_wrapping_detection},
        {"support_chamber_temp_control", context.support_chamber_temp_control},
        {"machine_supports_junction_deviation", context.machine_supports_junction_deviation},
        {"single_extruder_multi_material", context.single_extruder_multi_material},
        {"supports_wipe_tower_2", context.supports_wipe_tower_2},
        {"purge_in_prime_tower", context.purge_in_prime_tower},
        {"support_parallel_printheads", context.support_parallel_printheads},
        {"support_multi_bed_types", context.support_multi_bed_types},
        {"printer_model", context.printer_model},
        {"filament_cnt", context.filament_cnt},
        {"extruders_count", context.extruders_count},
        {"curr_bed_type", context.curr_bed_type},
        {"is_mixed_filament", is_mixed_arr},
        {"min_layer_height", context.min_layer_height},
        {"max_layer_height", context.max_layer_height},
        {"variant_index", context.variant_index},
        {"is_global_config", context.is_global_config},
        {"is_plate_config", context.is_plate_config},
        {"has_variable_layer_height", context.has_variable_layer_height},
        {"no_warn_mixed_sublayer_variable_layer", context.no_warn_mixed_sublayer_variable_layer}
    };

    return json{
        {"fields", fields_json},
        {"fixes", fixes_json},
        {"messages", messages_json},
        {"context", context_json}
    };
}

json Engine::Impl::op_setOptions(const json& args) {
    json errors = json::array();
    const auto normalized = normalize_options(args.value("options", json::object()), errors);
    if (!has_fatal_errors(errors)) {
        auto staged = m_options_override;
        staged.apply(normalized);
        m_options_override = std::move(staged);
    }
    return json{{"errors", errors}};
}

json Engine::Impl::op_normalizeOptions(const json& args) {
    json errors = json::array();
    const auto normalized = normalize_options(args.at("options"), errors);
    json options = json::object();
    if (!has_fatal_errors(errors))
        for (const auto& key : normalized.keys()) options[key] = normalized.opt_serialize(key);
    return {{"options", options}, {"errors", errors}};
}

json Engine::Impl::op_resolvePreset(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const std::string kind = args.at("kind").get<std::string>();
    auto* collection = kind == "printer" ? &m_bundle->printers : kind == "process" ? &m_bundle->prints :
        kind == "filament" ? &m_bundle->filaments : nullptr;
    if (!collection) throw Slic3r::RuntimeError("Unknown preset kind: " + kind);
    const std::string name = args.at("name").get<std::string>();
    const auto* preset = collection->find_preset(name, false);
    if (!preset) throw Slic3r::RuntimeError("Unknown preset: " + name);
    return {{"name", preset->name}};
}


// Parses one desktop preset file (.json or a single-preset .ini) the way desktop loads it,
// including legacy key migration, and returns its options serialized like op_getConfig.
json Engine::Impl::op_parsePreset(const json& args) {
    const std::string format = args.value("format", "json");
    const std::string text = args.at("text").get<std::string>();

    Slic3r::DynamicPrintConfig config;
    Slic3r::ConfigSubstitutionContext ctx(Slic3r::ForwardCompatibilitySubstitutionRule::Enable);
    json meta = json::object();
    if (format == "ini") {
        config.load_from_ini_string(text, Slic3r::ForwardCompatibilitySubstitutionRule::Enable);
    } else {
        // load_from_json() only reads files, so stage the text in MEMFS.
        const std::string path = "/tmp/orca_preset_import.json";
        {
            std::ofstream out(path, std::ios::binary | std::ios::trunc);
            out << text;
        }
        std::map<std::string, std::string> key_values;
        std::string reason;
        const int rc = config.load_from_json(path, ctx, false, key_values, reason);
        std::remove(path.c_str());
        if (rc != 0) throw Slic3r::RuntimeError("Invalid preset JSON: " + reason);
        for (const auto& [key, value] : key_values) meta[key] = value;
    }

    json values = json::object();
    for (const std::string& key : config.keys()) values[key] = config.opt_serialize(key);
    return {{"config", values}, {"meta", meta}, {"droppedKeys", ctx.unrecogized_keys}};
}

json Engine::Impl::op_resetOptions(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");

    auto baseline_config = m_bundle->full_config();
    const auto* colours = baseline_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    const size_t total_slots = colours ? colours->values.size() : (m_selected_filaments.empty() ? 1 : m_selected_filaments.size());

    if (args.contains("removeFilamentSlot") && !args.at("removeFilamentSlot").is_boolean())
        throw Slic3r::RuntimeError("removeFilamentSlot must be a boolean");
    if (args.value("removeFilamentSlot", false)) {
        // This is a pure projection of supplied project overrides, before the
        // caller changes selected presets and therefore the native slot count.
        if (total_slots < 2 || m_bundle->filament_presets.size() != total_slots)
            throw Slic3r::RuntimeError("Invalid current filament slot count");
        if (!args.contains("filamentIndex") || !args.at("filamentIndex").is_number_integer() ||
            (!args.at("filamentIndex").is_number_unsigned() && args.at("filamentIndex").get<int64_t>() < 0) ||
            args.at("filamentIndex").get<uint64_t>() >= total_slots)
            throw Slic3r::RuntimeError("Invalid filament index");
        if (!args.contains("overrides") || !args.at("overrides").is_object())
            throw Slic3r::RuntimeError("Filament overrides must be an object");
        if (args.contains("baseline") && !args.at("baseline").is_object())
            throw Slic3r::RuntimeError("Preset baseline must be an object");

        const size_t slot = args.at("filamentIndex").get<size_t>();
        json errors = json::array();
        const auto normalized = normalize_options(args.at("overrides"), errors);
        if (has_fatal_errors(errors)) throw Slic3r::RuntimeError("Invalid filament overrides: " + errors.dump());
        const auto projected = project_removed_slot(normalized, total_slots, slot, true);
        json remaining_overrides = json::object();
        for (const auto& key : projected.keys()) remaining_overrides[key] = projected.opt_serialize(key);
        return json{{"filamentOverrides", remaining_overrides}};
    }

    if (args.contains("filamentIndex") && !args.at("filamentIndex").is_null()) {
        if (!args.at("filamentIndex").is_number_integer() || args.at("filamentIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid filament index");
        }
        if (args.at("filamentIndex").get<size_t>() >= total_slots) {
            throw Slic3r::RuntimeError("Invalid filament index");
        }
    }
    if (args.contains("layoutIndex") && !args.at("layoutIndex").is_null()) {
        if (!args.at("layoutIndex").is_number_integer() || args.at("layoutIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid layout index");
        }
    }

    if (args.empty() || (!args.contains("filamentIndex") && !args.contains("key") && !args.contains("overrides"))) {
        m_options_override.clear();
        return json::object();
    }

    if (args.contains("overrides") && args.contains("filamentIndex")) {
        if (args.at("filamentIndex").is_null()) throw Slic3r::RuntimeError("Invalid filament index");
        if (args.contains("baseline") && !args.at("baseline").is_object())
            throw Slic3r::RuntimeError("Preset baseline must be an object");
        const size_t slot = args.at("filamentIndex").get<size_t>();
        const auto& filament_keys = Slic3r::Preset::filament_options();
        const size_t count = total_slots;
        if (count == 0 || slot >= count) throw Slic3r::RuntimeError("Invalid filament index");

        json remaining_overrides = json::object();
        for (const auto& [key, val] : args["overrides"].items()) {
            if (!Slic3r::print_config_def.has(key)) continue;
            if (key != "filament_colour" && std::find(filament_keys.begin(), filament_keys.end(), key) == filament_keys.end()) {
                remaining_overrides[key] = val;
                continue;
            }

            // Web user presets supply an effective baseline. Resetting one
            // slot against its system parent would overwrite saved values
            // whenever another slot retains an override for the same key.
            if (args.contains("baseline") && args.at("baseline").contains(key))
                baseline_config.set_deserialize_strict(key, args.at("baseline").at(key).get<std::string>());
            const auto* base_opt = baseline_config.option(key);
            if (!base_opt) continue;

            const auto* base_vec = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(base_opt);
            if (!base_vec) {
                if (slot != 0) {
                    remaining_overrides[key] = val;
                }
                continue;
            }

            std::unique_ptr<Slic3r::ConfigOption> cur_opt(base_opt->clone());
            bool parsed = false;
            try {
                if (val.is_string()) {
                    parsed = cur_opt->deserialize(val.get<std::string>());
                }
            } catch (...) {
                parsed = false;
            }
            if (!parsed) continue;

            auto* cur_vec = dynamic_cast<Slic3r::ConfigOptionVectorBase*>(cur_opt.get());
            if (!cur_vec) continue;

            const size_t stride = (count > 0 && cur_vec->size() >= count && cur_vec->size() % count == 0) ? (cur_vec->size() / count) : 1;
            const size_t start = slot * stride;

            if (start + stride <= cur_vec->size() && start + stride <= base_vec->size()) {
                for (size_t i = 0; i < stride; ++i) {
                    cur_vec->set_at(base_opt, start + i, start + i);
                }
            }

            if (!cur_opt->operator==(*base_opt)) {
                remaining_overrides[key] = cur_opt->serialize();
            }
        }
        return json{{"filamentOverrides", remaining_overrides}};
    }

    if (args.contains("key")) {
        const std::string key = args.at("key").get<std::string>();
        if (!Slic3r::print_config_def.has(key)) throw Slic3r::RuntimeError("Unknown option key");

        if (!args.contains("filamentIndex") && !args.contains("layoutIndex")) {
            m_options_override.erase(key);
            return json::object();
        }

        const bool project_slot = args.contains("filamentIndex") && !args.at("filamentIndex").is_null();
        const size_t slot = project_slot ? args.at("filamentIndex").get<size_t>() : 0;
        const bool has_layout = args.contains("layoutIndex") && !args.at("layoutIndex").is_null();
        const size_t layout_idx = has_layout ? args.at("layoutIndex").get<size_t>() : 0;

        const auto* base_opt = baseline_config.option(key);
        if (!base_opt) return json::object();

        auto* cur_opt = m_options_override.option(key);
        if (!cur_opt) return json::object();

        const auto* base_vec = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(base_opt);
        auto* cur_vec = dynamic_cast<Slic3r::ConfigOptionVectorBase*>(cur_opt);

        const size_t count = total_slots;
        if (project_slot && (count == 0 || slot >= count)) throw Slic3r::RuntimeError("Invalid filament index");

        if (!base_vec || !cur_vec) {
            if (has_layout && layout_idx > 0) throw Slic3r::RuntimeError("Invalid layout index");
            m_options_override.erase(key);
            return json::object();
        }

        const size_t stride = (count > 0 && base_vec->size() >= count && base_vec->size() % count == 0) ? (base_vec->size() / count) : base_vec->size();
        const size_t start = (count > 0 && base_vec->size() >= count && base_vec->size() % count == 0 && project_slot) ? slot * stride : 0;

        if (has_layout && layout_idx >= stride && project_slot) throw Slic3r::RuntimeError("Invalid layout index");
        if (has_layout && layout_idx >= base_vec->size() && !project_slot) throw Slic3r::RuntimeError("Invalid layout index");

        if (has_layout) {
            if (start + layout_idx < cur_vec->size() && start + layout_idx < base_vec->size()) {
                cur_vec->set_at(base_opt, start + layout_idx, start + layout_idx);
            }
        } else if (project_slot) {
            for (size_t i = 0; i < stride && start + i < cur_vec->size() && start + i < base_vec->size(); ++i) {
                cur_vec->set_at(base_opt, start + i, start + i);
            }
        }

        if (cur_opt->operator==(*base_opt)) {
            m_options_override.erase(key);
        }
        return json::object();
    }

    return json::object();
}

namespace {

bool is_step_file(const std::string& path) {
    return boost::algorithm::iends_with(path, ".step") ||
           boost::algorithm::iends_with(path, ".stp");
}

Slic3r::Model read_model_file(const std::string& path, const json& args) {
    if (is_step_file(path)) {
#ifdef SLIC3R_NO_OCCT
        throw Slic3r::RuntimeError("STEP format is not supported in this build (OCCT disabled); "
                                   "tessellate it with the STEP module and use loadStepMesh");
#else
        double linear_deflection = 0.003;
        if (args.contains("linear_deflection")) {
            if (!args["linear_deflection"].is_number()) {
                throw Slic3r::RuntimeError("linear_deflection must be a positive finite number");
            }
            linear_deflection = args["linear_deflection"].get<double>();
        } else if (args.contains("linearDeflection")) {
            if (!args["linearDeflection"].is_number()) {
                throw Slic3r::RuntimeError("linear_deflection must be a positive finite number");
            }
            linear_deflection = args["linearDeflection"].get<double>();
        }

        double angle_deflection = 0.5;
        if (args.contains("angle_deflection")) {
            if (!args["angle_deflection"].is_number()) {
                throw Slic3r::RuntimeError("angle_deflection must be a positive finite number");
            }
            angle_deflection = args["angle_deflection"].get<double>();
        } else if (args.contains("angleDeflection")) {
            if (!args["angleDeflection"].is_number()) {
                throw Slic3r::RuntimeError("angle_deflection must be a positive finite number");
            }
            angle_deflection = args["angleDeflection"].get<double>();
        }

        if (!std::isfinite(linear_deflection) || linear_deflection <= 0.0) {
            throw Slic3r::RuntimeError("linear_deflection must be a positive finite number");
        }
        if (!std::isfinite(angle_deflection) || angle_deflection <= 0.0) {
            throw Slic3r::RuntimeError("angle_deflection must be a positive finite number");
        }

        bool is_split_compound = args.value("is_split_compound", args.value("splitCompound", false));
        return Slic3r::Model::read_from_step(
            path,
            Slic3r::LoadStrategy::AddDefaultInstances | Slic3r::LoadStrategy::LoadModel,
            nullptr,
            nullptr,
            nullptr,
            linear_deflection,
            angle_deflection,
            is_split_compound
        );
#endif
    }
    return Slic3r::Model::read_from_file(
        path,
        nullptr,
        nullptr,
        Slic3r::LoadStrategy::AddDefaultInstances | Slic3r::LoadStrategy::LoadModel
    );
}

} // namespace

json Engine::Impl::op_loadModel(const json& args) {
    std::string path = args.at("path").get<std::string>();
    return commit_loaded_model(read_model_file(path, args), path, true);
}

json Engine::Impl::op_addModel(const json& args) {
    std::string path = args.at("path").get<std::string>();
    return commit_loaded_model(read_model_file(path, args), path, false);
}

namespace {

// Packed tessellation written by the standalone STEP module (wasm/step/main.cpp),
// little endian: "STM1", u32 solid count, then per solid u32 name length, UTF-8
// name, u32 vertex count, u32 triangle count, f32 xyz[vertex count * 3] and
// u32 indices[triangle count * 3].
struct PackedStepSolid {
    std::string           name;
    std::vector<float>    positions;
    std::vector<uint32_t> indices;
};

std::vector<PackedStepSolid> parse_packed_step_mesh(const std::string& bytes) {
    const char* data = bytes.data();
    const uint64_t size = bytes.size();
    uint64_t off = 0;
    auto need = [&](uint64_t n) {
        if (n > size - off)
            throw Slic3r::RuntimeError("Malformed STEP mesh: unexpected end of data");
    };
    auto read_u32 = [&]() {
        need(4);
        const uint8_t* p = reinterpret_cast<const uint8_t*>(data + off);
        off += 4;
        return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
    };

    need(4);
    if (std::memcmp(data, "STM1", 4) != 0)
        throw Slic3r::RuntimeError("Malformed STEP mesh: bad magic");
    off = 4;
    const uint32_t solid_count = read_u32();

    std::vector<PackedStepSolid> solids;
    for (uint32_t s = 0; s < solid_count; ++s) {
        PackedStepSolid solid;
        const uint32_t name_length = read_u32();
        need(name_length);
        solid.name.assign(data + off, name_length);
        off += name_length;
        const uint32_t vertex_count = read_u32();
        const uint32_t triangle_count = read_u32();
        const uint64_t position_bytes = uint64_t(vertex_count) * 3 * sizeof(float);
        need(position_bytes);
        solid.positions.resize(size_t(vertex_count) * 3);
        if (position_bytes > 0)
            std::memcpy(solid.positions.data(), data + off, position_bytes);
        off += position_bytes;
        const uint64_t index_bytes = uint64_t(triangle_count) * 3 * sizeof(uint32_t);
        need(index_bytes);
        solid.indices.resize(size_t(triangle_count) * 3);
        if (index_bytes > 0)
            std::memcpy(solid.indices.data(), data + off, index_bytes);
        off += index_bytes;

        for (float v : solid.positions)
            if (!std::isfinite(v))
                throw Slic3r::RuntimeError("Malformed STEP mesh: non-finite vertex position");
        for (uint32_t i : solid.indices)
            if (i >= vertex_count)
                throw Slic3r::RuntimeError("Malformed STEP mesh: vertex index out of range");
        solids.push_back(std::move(solid));
    }
    if (off != size)
        throw Slic3r::RuntimeError("Malformed STEP mesh: trailing data");
    return solids;
}

} // namespace

// Imports the packed mesh of the STEP module. Builds the same Model that
// Step::mesh() produced: one object named after the STEP file and one volume
// per solid, each through TriangleMesh::from_stl.
json Engine::Impl::op_loadStepMesh(const json& args) {
    const std::string path = args.at("path").get<std::string>();
    std::string name = args.at("name").get<std::string>();
    const size_t slash = name.find_last_of("/\\");
    if (slash != std::string::npos)
        name.erase(0, slash + 1);
    if (name.empty())
        throw Slic3r::RuntimeError("loadStepMesh requires the STEP file name");
    const bool replace = args.value("replace", false);

    std::string bytes;
    {
        std::ifstream in(path, std::ios::binary);
        if (!in.is_open())
            throw Slic3r::RuntimeError("Cannot open STEP mesh: " + path);
        std::ostringstream buffer;
        buffer << in.rdbuf();
        bytes = buffer.str();
    }
    // The packed file is only a hand-off from the STEP module; free its MEMFS storage.
    std::remove(path.c_str());
    const std::vector<PackedStepSolid> solids = parse_packed_step_mesh(bytes);
    bytes = std::string();

    const std::string input_file = "/models/" + name;
    Slic3r::Model loaded_model;
    Slic3r::ModelObject* new_object = loaded_model.add_object();
    new_object->name = name;
    new_object->input_file = input_file;
    for (const PackedStepSolid& solid : solids) {
        //BBS: maybe mesh is empty from step file. Don't add
        if (solid.indices.empty())
            continue;
        Slic3r::TriangleMesh triangle_mesh = Slic3r::step_indexed_to_triangle_mesh(
            solid.positions.data(), solid.indices.data(), solid.indices.size() / 3);
        Slic3r::ModelVolume* new_volume = new_object->add_volume(std::move(triangle_mesh));
        new_volume->name = solid.name;
        new_volume->source.input_file = input_file;
        new_volume->source.object_idx = 0;
        new_volume->source.volume_idx = (int)new_object->volumes.size() - 1;
    }
    if (new_object->volumes.empty())
        throw Slic3r::RuntimeError("Meshing of a model file failed or no valid shape.");
    loaded_model.add_default_instances();

    return commit_loaded_model(std::move(loaded_model), path, replace);
}

json Engine::Impl::commit_loaded_model(Slic3r::Model&& loaded_model, const std::string& path, bool replace) {
    m_calib_params.mode = Slic3r::CalibMode::Calib_None; // as desktop load_files() does
    if (loaded_model.objects.empty())
        throw Slic3r::RuntimeError("No objects loaded from file: " + path);

    if (replace) {
        m_model = std::move(loaded_model);

        json objects_arr = json::array();
        for (const auto* obj : m_model.objects) {
            Slic3r::Vec3d sz = obj->bounding_box_exact().size();
            objects_arr.push_back({
                {"id", obj->id().id},
                {"name", obj->name},
                {"instances", obj->instances.size()},
                {"volumes", obj->volumes.size()},
                {"size", {sz.x(), sz.y(), sz.z()}}
            });
        }
        return json{{"objects", objects_arr}};
    }

    json objects_arr = json::array();
    for (const auto* obj : loaded_model.objects) {
        Slic3r::ModelObject* new_obj = m_model.add_object(*obj);
        if (new_obj->instances.empty()) {
            new_obj->add_instance();
        }
        // Like the desktop's file loading: mesh centered on the object origin,
        // so gizmo rotation and scale pivot on the object's center.
        new_obj->center_around_origin();

        Slic3r::Vec3d sz = new_obj->bounding_box_exact().size();
        objects_arr.push_back({
            {"id", new_obj->id().id},
            {"name", new_obj->name},
            {"instances", new_obj->instances.size()},
            {"volumes", new_obj->volumes.size()},
            {"size", {sz.x(), sz.y(), sz.z()}}
        });
    }

    return json{{"objects", objects_arr}};
}

json Engine::Impl::op_listObjects(const json& /*args*/) {
    json objects_arr = json::array();
    for (const auto* obj : m_model.objects) {
        if (!obj) continue;
        json instances_arr = json::array();
        for (const auto* inst : obj->instances) {
            if (!inst) continue;
            Slic3r::Vec3d offset = inst->get_offset();
            Slic3r::Vec3d rotation = inst->get_rotation();
            Slic3r::Vec3d scale = inst->get_scaling_factor();
            Slic3r::Vec3d mirror = inst->get_mirror();
            instances_arr.push_back({
                {"id", inst->id().id},
                {"mirror", {mirror.x(), mirror.y(), mirror.z()}},
                {"offset", {offset.x(), offset.y(), offset.z()}},
                {"rotation", {rotation.x(), rotation.y(), rotation.z()}},
                {"scale", {scale.x(), scale.y(), scale.z()}}
            });
        }
        Slic3r::Vec3d sz = obj->bounding_box_exact().size();
        objects_arr.push_back({
            {"id", obj->id().id},
            {"name", obj->name},
            {"volumes", obj->volumes.size()},
            {"instances", instances_arr},
            {"size", {sz.x(), sz.y(), sz.z()}}
        });
    }
    return objects_arr;
}

json Engine::Impl::op_getMesh(const json& args) {
    size_t object_id = 0;
    if (args.contains("objectId")) {
        object_id = args["objectId"].get<size_t>();
    } else if (args.contains("id")) {
        object_id = args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("getMesh requires objectId");
    }

    const Slic3r::ModelObject* obj = nullptr;
    for (const auto* o : m_model.objects) {
        if (o && o->id().id == object_id) {
            obj = o;
            break;
        }
    }
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    Slic3r::TriangleMesh mesh;
    json volumes_meta = json::array();
    const bool for_viewer = args.value("forViewer", false);
    for (const Slic3r::ModelVolume* v : obj->volumes) {
        if (v && (for_viewer || v->is_model_part())) {
            uint32_t first_facet = static_cast<uint32_t>(mesh.its.indices.size());
            uint32_t first_vertex = static_cast<uint32_t>(mesh.its.vertices.size());
            Slic3r::TriangleMesh vol_mesh(v->mesh());
            if (!for_viewer) vol_mesh.transform(v->get_matrix());
            mesh.merge(vol_mesh);
            uint32_t facet_count = static_cast<uint32_t>(vol_mesh.its.indices.size());
            volumes_meta.push_back({
                {"volumeId", v->id().id},
                {"firstFacet", first_facet},
                {"facetCount", facet_count}
            });
            if (for_viewer) {
                auto& meta = volumes_meta.back();
                meta.update(OrcaWasm::getVolume(m_model, {{"objectId", object_id}, {"volumeId", v->id().id}}));
                meta["firstVertex"] = first_vertex;
                meta["vertexCount"] = vol_mesh.its.vertices.size();
            }
        }
    }
    if (mesh.empty() && !for_viewer) {
        volumes_meta = json::array();
        for (const Slic3r::ModelVolume* v : obj->volumes) {
            if (v) {
                uint32_t first_facet = static_cast<uint32_t>(mesh.its.indices.size());
                Slic3r::TriangleMesh vol_mesh(v->mesh());
                vol_mesh.transform(v->get_matrix());
                mesh.merge(vol_mesh);
                uint32_t facet_count = static_cast<uint32_t>(vol_mesh.its.indices.size());
                volumes_meta.push_back({
                    {"volumeId", v->id().id},
                    {"firstFacet", first_facet},
                    {"facetCount", facet_count}
                });
            }
        }
    }

    uint32_t vertex_count = static_cast<uint32_t>(mesh.its.vertices.size());
    uint32_t triangle_count = static_cast<uint32_t>(mesh.its.indices.size());

    std::string out_dir = "/out";
    std::filesystem::create_directories(out_dir);
    std::string out_path = out_dir + "/mesh_" + std::to_string(object_id) + (for_viewer ? "_viewer.bin" : ".bin");

    std::ofstream os(out_path, std::ios::binary);
    if (!os.is_open()) {
        throw Slic3r::RuntimeError("Failed to open file for writing: " + out_path);
    }

    uint32_t header[4] = {
        0x4D455348, // MESH
        vertex_count,
        triangle_count,
        0
    };
    os.write(reinterpret_cast<const char*>(header), sizeof(header));

    if (vertex_count > 0) {
        os.write(reinterpret_cast<const char*>(mesh.its.vertices.data()), vertex_count * 3 * sizeof(float));
    }

    if (triangle_count > 0) {
        os.write(reinterpret_cast<const char*>(mesh.its.indices.data()), triangle_count * 3 * sizeof(uint32_t));
    }
    os.close();

    return json{
        {"path", out_path},
        {"vertexCount", vertex_count},
        {"triangleCount", triangle_count},
        {"volumes", volumes_meta}
    };
}

json Engine::Impl::op_setInstanceTransform(const json& args) {
    size_t object_id = 0;
    if (args.contains("objectId")) {
        object_id = args["objectId"].get<size_t>();
    } else if (args.contains("id")) {
        object_id = args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("setInstanceTransform requires objectId");
    }

    size_t instance_id = 0;
    if (args.contains("instanceId")) {
        instance_id = args["instanceId"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("setInstanceTransform requires instanceId");
    }

    Slic3r::ModelObject* obj = nullptr;
    for (auto* o : m_model.objects) {
        if (o && o->id().id == object_id) {
            obj = o;
            break;
        }
    }
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    Slic3r::ModelInstance* inst = nullptr;
    for (auto* i : obj->instances) {
        if (i && i->id().id == instance_id) {
            inst = i;
            break;
        }
    }
    if (!inst) {
        throw Slic3r::RuntimeError("Instance not found: " + std::to_string(instance_id));
    }

    // Setting the scale rebuilds the matrix from the rotation and positive factors, which would undo a mirror.
    const Slic3r::Vec3d mirror = inst->get_mirror();
    if (args.contains("offset") && !args["offset"].is_null()) {
        inst->set_offset(parse_vec3d(args["offset"]));
    }
    if (args.contains("rotation") && !args["rotation"].is_null()) {
        inst->set_rotation(parse_vec3d(args["rotation"]));
    }
    if (args.contains("scale") && !args["scale"].is_null()) {
        const auto& s = args["scale"];
        if (s.is_number()) {
            double v = s.get<double>();
            inst->set_scaling_factor(Slic3r::Vec3d(v, v, v));
        } else {
            inst->set_scaling_factor(parse_vec3d(s));
        }
        inst->set_mirror(mirror);
    }

    // Drop to bed
    obj->invalidate_bounding_box();
    Slic3r::BoundingBoxf3 bb = obj->instance_bounding_box(*inst);
    if (bb.defined) {
        double min_z = bb.min.z();
        inst->set_offset(Slic3r::Z, inst->get_offset(Slic3r::Z) - min_z);
        obj->invalidate_bounding_box();
    }

    return json::object();
}

json Engine::Impl::op_deleteObject(const json& args) {
    size_t object_id = 0;
    if (args.contains("objectId")) {
        object_id = args["objectId"].get<size_t>();
    } else if (args.contains("id")) {
        object_id = args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("deleteObject requires objectId");
    }

    bool deleted = m_model.delete_object(Slic3r::ObjectID(object_id));
    if (!deleted) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    return json::object();
}

// Moves an object to another position in the model's object list (the order of the Objects list and of by-object printing).
json Engine::Impl::op_moveObject(const json& args) {
    const size_t object_id = args.at("objectId").get<size_t>();
    const int to_index = args.at("toIndex").get<int>();

    auto& objects = m_model.objects;
    auto it = std::find_if(objects.begin(), objects.end(), [&](const Slic3r::ModelObject* o) { return o && o->id().id == object_id; });
    if (it == objects.end()) throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));

    Slic3r::ModelObject* obj = *it;
    objects.erase(it);
    const size_t target = static_cast<size_t>(std::clamp(to_index, 0, static_cast<int>(objects.size())));
    objects.insert(objects.begin() + target, obj);
    return {{"index", target}};
}

json Engine::Impl::op_duplicateInstance(const json& args) {
    size_t object_id = 0;
    if (args.contains("objectId")) {
        object_id = args["objectId"].get<size_t>();
    } else if (args.contains("id")) {
        object_id = args["id"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("duplicateInstance requires objectId");
    }

    size_t instance_id = 0;
    if (args.contains("instanceId")) {
        instance_id = args["instanceId"].get<size_t>();
    } else {
        throw Slic3r::RuntimeError("duplicateInstance requires instanceId");
    }

    Slic3r::ModelObject* obj = nullptr;
    for (auto* o : m_model.objects) {
        if (o && o->id().id == object_id) {
            obj = o;
            break;
        }
    }
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    const Slic3r::ModelInstance* inst = nullptr;
    for (const auto* i : obj->instances) {
        if (i && i->id().id == instance_id) {
            inst = i;
            break;
        }
    }
    if (!inst) {
        throw Slic3r::RuntimeError("Instance not found: " + std::to_string(instance_id));
    }

    Slic3r::ModelInstance* new_inst = obj->add_instance(*inst);
    return json{
        {"instanceId", new_inst->id().id},
        {"id", new_inst->id().id}
    };
}

json Engine::Impl::op_mirrorInstance(const json& args) {
    if (!args.contains("objectId") || !args.contains("instanceId") || !args.contains("axis"))
        throw Slic3r::RuntimeError("mirrorInstance requires objectId, instanceId and axis (0, 1 or 2)");
    const size_t object_id = args["objectId"].get<size_t>();
    const size_t instance_id = args["instanceId"].get<size_t>();
    const int axis = args["axis"].get<int>();
    if (axis < 0 || axis > 2)
        throw Slic3r::RuntimeError("mirrorInstance axis must be 0, 1 or 2");

    Slic3r::ModelObject* obj = nullptr;
    for (auto* o : m_model.objects)
        if (o && o->id().id == object_id) { obj = o; break; }
    if (!obj)
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    Slic3r::ModelInstance* inst = nullptr;
    for (auto* i : obj->instances)
        if (i && i->id().id == instance_id) { inst = i; break; }
    if (!inst)
        throw Slic3r::RuntimeError("Instance not found: " + std::to_string(instance_id));

    // Mirror in the object's own axes by composing with a reflection, so a second call restores the instance. (A mirrored
    // matrix has several equal decompositions into rotation, scale and signs, so the signs alone cannot be toggled.)
    Slic3r::Vec3d flip(1., 1., 1.);
    flip(axis) = -1.;
    Slic3r::Transform3d matrix = inst->get_matrix() * Eigen::Scaling(flip);
    inst->set_transformation(Slic3r::Geometry::Transformation(matrix));

    obj->invalidate_bounding_box();
    Slic3r::BoundingBoxf3 bb = obj->instance_bounding_box(*inst);
    if (bb.defined) {
        inst->set_offset(Slic3r::Z, inst->get_offset(Slic3r::Z) - bb.min.z());
        obj->invalidate_bounding_box();
    }
    return json::object();
}

json Engine::Impl::op_copySelection(const json& args) {
    const auto find_source = [&](size_t id) {
        for (auto* object : m_model.objects)
            if (object->id().id == id) return object;
        throw Slic3r::RuntimeError("Clipboard object not found");
    };
    std::unordered_map<size_t, std::unordered_set<size_t>> selection;
    for (const auto& ref : args.at("instances"))
        selection[ref.at("objectId").get<size_t>()].insert(ref.at("instanceId").get<size_t>());
    Slic3r::Model snapshot;
    std::vector<size_t> object_order;
    for (const auto* object : m_model.objects)
        if (selection.count(object->id().id)) object_order.push_back(object->id().id);
    if (object_order.size() != selection.size()) throw Slic3r::RuntimeError("Clipboard object not found");
    for (size_t object_id : object_order) {
        const auto& selected_instances = selection.at(object_id);
        auto* source = find_source(object_id);
        for (size_t id : selected_instances)
            if (std::none_of(source->instances.begin(), source->instances.end(), [id](const auto* instance) { return instance->id().id == id; }))
                throw Slic3r::RuntimeError("Clipboard instance not found");
        auto* copy = snapshot.add_object(*source);
        for (size_t i = source->instances.size(); i-- > 0;)
            if (selected_instances.count(source->instances[i]->id().id) == 0) copy->delete_instance(i);
    }
    m_clipboard = std::move(snapshot);
    if (args.value("cut", false)) {
        for (const auto& entry : selection) {
            auto* source = find_source(entry.first);
            for (size_t i = source->instances.size(); i-- > 0;)
                if (entry.second.count(source->instances[i]->id().id)) source->delete_instance(i);
            if (source->instances.empty()) m_model.delete_object(source);
        }
    }
    return json{{"objects", m_clipboard.objects.size()}};
}

json Engine::Impl::op_pasteSelection(const json& args) {
    const auto offset = args.value("offset", std::vector<double>{20, 20, 0});
    if (offset.size() != 3 || !std::all_of(offset.begin(), offset.end(), [](double value) { return std::isfinite(value); }))
        throw Slic3r::RuntimeError("Invalid paste offset");
    json ids = json::array();
    for (const auto* object : m_clipboard.objects) {
        auto* copy = m_model.add_object(*object);
        copy->translate_instances(Slic3r::Vec3d(offset[0], offset[1], offset[2]));
        ids.push_back(copy->id().id);
    }
    return json{{"objectIds", ids}};
}

json Engine::Impl::op_cloneObject(const json& args) {
    if (!args.contains("objectId"))
        throw Slic3r::RuntimeError("cloneObject requires objectId");
    const size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* source = nullptr;
    for (auto* o : m_model.objects)
        if (o && o->id().id == object_id) { source = o; break; }
    if (!source)
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));

    // A full copy: volumes, settings, painting and every instance, as an independent object.
    Slic3r::ModelObject* copy = m_model.add_object(*source);
    return json{{"objectId", copy->id().id}, {"id", copy->id().id}};
}

json Engine::Impl::op_exportModel(const json& args) {
    const std::string format = args.value("format", "stl");
    if (format != "stl" && format != "3mf")
        throw Slic3r::RuntimeError("Unsupported model export format");
    const std::string path = args.value("path", "/out/model." + format);
    const size_t object_id = args.value("objectId", size_t(0));
    const int plate_index = args.value("plateIndex", -1);
    std::unordered_set<size_t> instance_ids;
    Slic3r::Vec3d origin = Slic3r::Vec3d::Zero();
    if (plate_index >= 0) {
        if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
        Slic3r::DynamicPrintConfig config = m_bundle->full_config();
        config.apply(m_options_override);
        OrcaEngine::listPlates(m_model, m_plate_data, config);
        if (static_cast<size_t>(plate_index) >= m_plate_data.size())
            throw Slic3r::RuntimeError("Plate not found");
        for (const auto& pair : m_plate_data[plate_index]->objects_and_instances)
            instance_ids.insert(m_model.objects[pair.first]->instances[pair.second]->id().id);
        double width, depth, height;
        OrcaEngine::getBedDimensions(config, width, depth, height);
        origin = OrcaEngine::computePlateOrigin(plate_index, m_plate_data.size(), width, depth);
    }
    Slic3r::Model selected;
    for (const auto* object : m_model.objects) {
        if (object_id != 0 && object->id().id != object_id) continue;
        auto* copy = selected.add_object(*object);
        for (size_t i = object->instances.size(); i-- > 0;) {
            if (plate_index >= 0 && instance_ids.count(object->instances[i]->id().id) == 0)
                copy->delete_instance(i);
            else
                copy->instances[i]->set_offset(copy->instances[i]->get_offset() - origin);
        }
        if (copy->instances.empty()) selected.delete_object(copy->id());
    }
    if (selected.objects.empty()) throw Slic3r::RuntimeError("No objects to export");
    // Native mesh export applies volume/instance transforms, including mirroring, and excludes modifiers.
    const bool written = format == "stl"
        ? Slic3r::store_stl(path.c_str(), &selected, true)
        : Slic3r::store_3mf(path.c_str(), &selected, nullptr, false);
    if (!written) throw Slic3r::RuntimeError("Model export failed");
    return json{{"path", path}, {"objects", selected.objects.size()}};
}

// Place only the imported group. Existing instances must retain their transforms
// unless the caller explicitly requests a full plate arrangement.
json Engine::Impl::op_placeObjects(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const auto ids = args.at("objectIds").get<std::unordered_set<size_t>>();
    Slic3r::BoundingBoxf3 bounds;
    std::vector<Slic3r::ModelObject*> objects;
    for (auto* object : m_model.objects) {
        if (ids.count(object->id().id) == 0) continue;
        objects.push_back(object);
        bounds.merge(object->bounding_box_exact());
    }
    if (!bounds.defined) throw Slic3r::RuntimeError("No imported objects to place");
    auto config = m_bundle->full_config();
    config.apply(m_options_override);
    Slic3r::BoundingBoxf bed;
    if (const auto* shape = config.opt<Slic3r::ConfigOptionPoints>("printable_area"))
        for (const auto& point : shape->values) bed.merge(point);
    const int plate_index = args.value("plateIndex", 0);
    if (plate_index < 0 || static_cast<size_t>(plate_index) >= std::max(size_t(1), m_plate_data.size()))
        throw Slic3r::RuntimeError("Invalid plate index");
    double width = 256, depth = 256, height = 256;
    OrcaEngine::getBedDimensions(config, width, depth, height);
    const auto origin = OrcaEngine::computePlateOrigin(plate_index, std::max(size_t(1), m_plate_data.size()), width, depth);
    const Slic3r::Vec2d center = bed.defined ? bed.center() : Slic3r::Vec2d(width / 2, depth / 2);
    const Slic3r::Vec3d delta(center.x() + origin.x() - bounds.center().x(),
                              center.y() + origin.y() - bounds.center().y(), -bounds.min.z());
    for (auto* object : objects) object->translate_instances(delta);
    return json{{"placed", objects.size()}};
}

json Engine::Impl::op_arrange(const json& args) {
    if (m_model.objects.empty())
        throw Slic3r::RuntimeError("No model loaded");
    if (!m_bundle)
        throw Slic3r::RuntimeError("Preset bundle not initialized");

    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    bool use_bed = args.value("useBed", false);
    int plate_index = args.value("plateIndex", -1);

    std::unordered_set<size_t> locked_instances;
    if (args.contains("lockedOrientations") && args["lockedOrientations"].is_array()) {
        for (const auto& el : args["lockedOrientations"]) {
            if (el.is_number()) locked_instances.insert(el.get<size_t>());
        }
    }

    Slic3r::BoundingBoxf bed_bbox;
    if (const auto *bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area");
        bed_shape_opt && !bed_shape_opt->values.empty()) {
        for (const auto &p : bed_shape_opt->values)
            bed_bbox.merge(p);
    }
    Slic3r::Vec2d bed_center = bed_bbox.defined ? bed_bbox.center() : Slic3r::Vec2d(100.0, 100.0);

    Slic3r::Vec3d plate_origin = {0, 0, 0};
    if (plate_index >= 0) {
        double bed_w = 256.0, bed_d = 256.0, bed_h = 256.0;
        OrcaEngine::getBedDimensions(config, bed_w, bed_d, bed_h);
        size_t total_plates = std::max(static_cast<size_t>(plate_index + 1), m_plate_data.size());
        if (total_plates == 0) total_plates = 1;
        plate_origin = OrcaEngine::computePlateOrigin(plate_index, total_plates, bed_w, bed_d);

        bed_center += Slic3r::Vec2d(plate_origin.x(), plate_origin.y());

        while (m_plate_data.size() < total_plates) {
            auto* pd = new Slic3r::PlateData();
            pd->plate_index = static_cast<int>(m_plate_data.size());
            pd->plate_name = "Plate " + std::to_string(pd->plate_index + 1);
            m_plate_data.push_back(pd);
        }
        OrcaEngine::assignInstancesToPlates(m_model, m_plate_data, config);
    }

    if (!use_bed && plate_index < 0 && locked_instances.empty()) {
        m_model.center_instances_around_point(bed_center);
        Slic3r::arrange_objects(m_model, Slic3r::InfiniteBed{Slic3r::Point::new_scale(bed_center.x(), bed_center.y())},
                                Slic3r::ArrangeParams{Slic3r::scaled(Slic3r::min_object_distance(config))});
        return json::object();
    }

    Slic3r::ModelInstancePtrs instances;
    auto input = Slic3r::get_arrange_polys(m_model, instances);
    if (plate_index >= 0) {
        // get_arrange_polys includes non-printable instances too. Filter both
        // parallel arrays explicitly so other plates retain their transforms.
        std::unordered_set<size_t> allowed_instances;
        for (const auto& pair : m_plate_data[plate_index]->objects_and_instances)
            allowed_instances.insert(m_model.objects[pair.first]->instances[pair.second]->id().id);
        for (size_t i = instances.size(); i-- > 0;) {
            if (allowed_instances.count(instances[i]->id().id) == 0) {
                instances.erase(instances.begin() + i);
                input.erase(input.begin() + i);
            }
        }
    }

    for (size_t i = 0; i < instances.size(); ++i) {
        if (locked_instances.count(instances[i]->id().id)) {
            input[i].orientation_locked = true;
        }
    }

    // Optional spacing (mm) between objects, replacing the one derived from the print settings.
    const double spacing_mm = args.contains("spacing") && args["spacing"].is_number() ? std::max(0.0, args["spacing"].get<double>()) : -1.0;
    Slic3r::ArrangeParams params{Slic3r::scaled(spacing_mm >= 0.0 ? spacing_mm : Slic3r::min_object_distance(config))};
    params.allow_rotations = args.value("allowRotations", false);
    Slic3r::arrangement::update_selected_items_inflation(input, &config, params);

    if (use_bed) {
        Slic3r::Points bed_points = Slic3r::get_bed_shape(config);
        if (bed_points.empty()) {
            if (const auto *bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area");
                bed_shape_opt && !bed_shape_opt->values.empty()) {
                for (const auto &p : bed_shape_opt->values)
                    bed_points.emplace_back(Slic3r::Point::new_scale(p.x(), p.y()));
            }
        }
        if (plate_index >= 0) {
            Slic3r::Point shift = Slic3r::Point::new_scale(plate_origin.x(), plate_origin.y());
            for (auto& p : bed_points) {
                p += shift;
            }
        }

        if (bed_points.size() >= 3) {
            Slic3r::arrangement::arrange(input, bed_points, params);
        } else {
            Slic3r::arrangement::arrange(input, Slic3r::InfiniteBed{Slic3r::Point::new_scale(bed_center.x(), bed_center.y())}, params);
        }
    } else {
        Slic3r::arrangement::arrange(input, Slic3r::InfiniteBed{Slic3r::Point::new_scale(bed_center.x(), bed_center.y())}, params);
    }

    Slic3r::apply_arrange_polys(input, instances, Slic3r::throw_if_out_of_bed);

    return json::object();
}

json Engine::Impl::op_openProject(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    m_calib_params.mode = Slic3r::CalibMode::Calib_None;
    return OrcaEngine::op_openProject(args, m_model, m_bundle, m_options_override, m_selected_printer, m_selected_process, m_selected_filaments, m_plate_data);
}

json Engine::Impl::op_saveProject(const json& args) {
    return OrcaEngine::op_saveProject(args, m_model, m_bundle, m_options_override, m_plate_data);
}

json Engine::Impl::op_getObjectTree(const json& args) {
    return OrcaWasm::getObjectTree(m_model, args);
}

json Engine::Impl::op_addVolume(const json& args) {
    return OrcaWasm::addVolume(m_model, args);
}

json Engine::Impl::op_moveVolume(const json& args) {
    return OrcaWasm::moveVolume(m_model, args);
}

json Engine::Impl::op_deleteVolume(const json& args) {
    return OrcaWasm::deleteVolume(m_model, args);
}

json Engine::Impl::op_renameObject(const json& args) {
    return OrcaWasm::renameObject(m_model, args);
}

json Engine::Impl::op_renameVolume(const json& args) {
    return OrcaWasm::renameVolume(m_model, args);
}

json Engine::Impl::op_setObjectConfig(const json& args) {
    return OrcaWasm::setObjectConfig(m_model, args);
}

json Engine::Impl::op_resetObjectConfig(const json& args) {
    return OrcaWasm::resetObjectConfig(m_model, args);
}

json Engine::Impl::op_setVolumeExtruder(const json& args) {
    return OrcaWasm::setVolumeExtruder(m_model, args);
}

json Engine::Impl::op_mergeObjects(const json& args) {
    if (!m_bundle) {
        return OrcaWasm::mergeObjects(m_model, args, &m_plate_data, nullptr);
    }
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);
    return OrcaWasm::mergeObjects(m_model, args, &m_plate_data, &config);
}

json Engine::Impl::op_setVolumeType(const json& args) {
    return OrcaWasm::setVolumeType(m_model, args);
}

json Engine::Impl::op_listPlates(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);
    return OrcaEngine::listPlates(m_model, m_plate_data, config);
}

json Engine::Impl::op_addPlate(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);
    return OrcaEngine::addPlate(args, m_model, m_plate_data, config);
}

json Engine::Impl::op_duplicatePlate(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    auto config = m_bundle->full_config();
    config.apply(m_options_override);
    return OrcaEngine::duplicatePlate(args, m_model, m_plate_data, config);
}

json Engine::Impl::op_deletePlate(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);
    return OrcaEngine::deletePlate(args, m_model, m_plate_data, config);
}

json Engine::Impl::op_setPlateConfig(const json& args) {
    return OrcaEngine::setPlateConfig(args, m_plate_data);
}
json Engine::Impl::op_getSupportPainting(const json& args) {
    return OrcaWasm::getSupportPainting(m_model, args);
}

json Engine::Impl::op_setSupportPainting(const json& args) {
    return OrcaWasm::setSupportPainting(m_model, args);
}

json Engine::Impl::op_clearSupportPainting(const json& args) {
    return OrcaWasm::clearSupportPainting(m_model, args);
}
json Engine::Impl::op_getSeamPainting(const json& args) {
    return OrcaWasm::getSeamPainting(m_model, args);
}

json Engine::Impl::op_setSeamPainting(const json& args) {
    return OrcaWasm::setSeamPainting(m_model, args);
}

json Engine::Impl::op_clearSeamPainting(const json& args) {
    return OrcaWasm::clearSeamPainting(m_model, args);
}

json Engine::Impl::op_cutObject(const json& args) {
    Slic3r::DynamicPrintConfig config = m_bundle ? m_bundle->full_config() : Slic3r::DynamicPrintConfig();
    return OrcaWasm::cutObject(m_model, m_plate_data, config, args);
}
json Engine::Impl::op_cutObjectWithConnectors(const json& args) {
    Slic3r::DynamicPrintConfig config = m_bundle ? m_bundle->full_config() : Slic3r::DynamicPrintConfig();
    return OrcaWasm::cutObjectWithConnectors(m_model, m_plate_data, config, args);
}

json Engine::Impl::op_getMeshHealth(const json& args) {
    return OrcaWasm::getMeshHealth(m_model, args);
}

json Engine::Impl::op_checkMeshHealth(const json& args) {
    return OrcaWasm::checkMeshHealth(m_model, args);
}

json Engine::Impl::op_repairObject(const json& args) {
    return OrcaWasm::repairObject(m_model, args);
}

json Engine::Impl::op_repairMesh(const json& args) {
    return OrcaWasm::repairMesh(m_model, args);
}

json Engine::Impl::op_paintStroke(const json& args) { return OrcaWasm::paintStroke(m_model, args); }
json Engine::Impl::op_getPaintOverlay(const json& args) { return OrcaWasm::getPaintOverlay(m_model, args); }
json Engine::Impl::op_getPaintData(const json& args) { return OrcaWasm::getPaintData(m_model, args); }
json Engine::Impl::op_setPaintData(const json& args) { return OrcaWasm::setPaintData(m_model, args); }
json Engine::Impl::op_clearPaint(const json& args) { return OrcaWasm::clearPaint(m_model, args); }

Slic3r::DynamicPrintConfig Engine::Impl::layer_config() const {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);
    return config;
}

json Engine::Impl::op_getLayerHeightProfile(const json& args) { return OrcaWasm::getLayerHeightProfile(m_model, layer_config(), args); }
json Engine::Impl::op_setLayerHeightProfile(const json& args) { return OrcaWasm::setLayerHeightProfile(m_model, layer_config(), args); }
json Engine::Impl::op_adaptiveLayerHeights(const json& args) { return OrcaWasm::adaptiveLayerHeights(m_model, layer_config(), args); }
json Engine::Impl::op_smoothLayerHeights(const json& args) { return OrcaWasm::smoothLayerHeights(m_model, layer_config(), args); }
json Engine::Impl::op_adjustLayerHeights(const json& args) { return OrcaWasm::adjustLayerHeights(m_model, layer_config(), args); }
json Engine::Impl::op_resetLayerHeights(const json& args) { return OrcaWasm::resetLayerHeights(m_model, layer_config(), args); }
json Engine::Impl::op_getObjectLayers(const json& args) { return OrcaWasm::getObjectLayers(m_model, layer_config(), args); }
json Engine::Impl::op_addText(const json& args) { return OrcaWasm::addText(m_model, m_plate_data, args); }
json Engine::Impl::op_updateText(const json& args) { return OrcaWasm::updateText(m_model, args); }
json Engine::Impl::op_getText(const json& args) { return OrcaWasm::getText(m_model, args); }
json Engine::Impl::op_getLayerEvents(const json& args) { return OrcaWasm::getLayerEvents(m_model, args); }
json Engine::Impl::op_setLayerEvents(const json& args) { return OrcaWasm::setLayerEvents(m_model, args); }
json Engine::Impl::op_clearLayerEvents(const json& args) { return OrcaWasm::clearLayerEvents(m_model, args); }


std::string Engine::Impl::op_slice(int jobId, const json& args) {
    struct SliceCleanupGuard {
        Engine::Impl* impl;
        int saved_curr_plate_index{0};
        std::vector<std::pair<Slic3r::ModelObject*, std::vector<bool>>> saved_inst;
        std::vector<std::pair<Slic3r::ModelObject*, bool>> saved_obj;

        ~SliceCleanupGuard() {
            {
                std::lock_guard<std::mutex> progress_lock(impl->m_progress_mutex);
                impl->m_progress_job_id = 0;
                impl->m_progress_percent = 0;
                impl->m_progress_text.clear();
            }
            std::lock_guard<std::mutex> lock(impl->m_cancel_mutex);
            impl->m_current_print = nullptr;
            impl->m_cancel_requested = false;
            if (impl->m_slice_jobs_queued_or_running > 0) {
                impl->m_slice_jobs_queued_or_running--;
            }
            impl->m_model.curr_plate_index = saved_curr_plate_index;
            for (auto& item : saved_obj) {
                item.first->printable = item.second;
            }
            for (auto& item : saved_inst) {
                for (size_t i = 0; i < std::min(item.first->instances.size(), item.second.size()); ++i) {
                    item.first->instances[i]->printable = item.second[i];
                }
            }
        }
    } slice_cleanup{this};
    slice_cleanup.saved_curr_plate_index = m_model.curr_plate_index;

    if (m_model.objects.empty())
        throw Slic3r::RuntimeError("No model loaded");
    if (!m_bundle)
        throw Slic3r::RuntimeError("Preset bundle not initialized");

    std::string out_path = args.at("outPath").get<std::string>();
    int threads = args.value("threads", 0);
    int plate_index = -1;
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
            plate_index = static_cast<int>(u);
        } else {
            int64_t s = v.get<int64_t>();
            if (s < 0) {
                throw Slic3r::RuntimeError("Invalid plateIndex: must be non-negative");
            }
            if (s > std::numeric_limits<int>::max()) {
                throw Slic3r::RuntimeError("Invalid plateIndex: out of range");
            }
            plate_index = static_cast<int>(s);
        }
    }
    m_model.curr_plate_index = (plate_index >= 0 ? plate_index : 0);

    // Ensure output directory exists
    std::filesystem::path p(out_path);
    if (p.has_parent_path()) {
        std::filesystem::create_directories(p.parent_path());
    }

    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    if (config.opt_string("before_layer_change_gcode").empty() && config.opt_string("layer_change_gcode").empty()) {
        config.set_key_value("before_layer_change_gcode", new Slic3r::ConfigOptionString("G92 E0"));
    }
    config.normalize_fdm();

    // Plate handling
    if (plate_index >= 0) {
        double bed_w = 256.0, bed_d = 256.0, bed_h = 256.0;
        OrcaEngine::getBedDimensions(config, bed_w, bed_d, bed_h);

        size_t total_plates = std::max(static_cast<size_t>(plate_index + 1), m_plate_data.size());
        if (total_plates == 0) total_plates = 1;

        while (m_plate_data.size() < total_plates) {
            auto* pd = new Slic3r::PlateData();
            pd->plate_index = static_cast<int>(m_plate_data.size());
            pd->plate_name = "Plate " + std::to_string(pd->plate_index + 1);
            m_plate_data.push_back(pd);
        }

        OrcaEngine::assignInstancesToPlates(m_model, m_plate_data, config);

        if (static_cast<size_t>(plate_index) < m_plate_data.size()) {
            const auto* pd = m_plate_data[plate_index];
            if (pd && !pd->config.empty()) {
                config.apply(pd->config);
            }
        }

        // Ensure wipe tower position is properly initialized and clamped inside printable area for plate
    }

    if (config.opt_bool("enable_prime_tower") && config.opt<Slic3r::ConfigOptionFloats>("nozzle_diameter") && config.opt<Slic3r::ConfigOptionFloats>("filament_diameter") && config.opt<Slic3r::ConfigOptionFloats>("filament_diameter")->values.size() > 1) {
        OrcaEngine::updateWipeTowerPosition(config, m_model, m_plate_data, (plate_index >= 0 ? plate_index : 0));
    }

    if (auto errors = config.validate(true); !errors.empty()) {
        std::string msg = "Config validation failed:\n";
        for (const auto &[k, v] : errors)
            msg += "  " + k + ": " + v + "\n";
        throw Slic3r::RuntimeError(msg);
    }

    try {
        for (auto* mo : m_model.objects) {
            slice_cleanup.saved_obj.emplace_back(mo, mo->printable);
            std::vector<bool> inst_p;
            inst_p.reserve(mo->instances.size());
            for (auto* inst : mo->instances) {
                inst_p.push_back(inst->printable);
            }
            slice_cleanup.saved_inst.emplace_back(mo, inst_p);
        }

        // Assignment is deliberately permissive (overlap/nearest plate). Slice
        // eligibility instead requires the complete transformed XY footprint.
        double bed_w, bed_d, bed_h;
        OrcaEngine::getBedDimensions(config, bed_w, bed_d, bed_h);
        const Slic3r::Vec3d origin = plate_index >= 0
            ? OrcaEngine::computePlateOrigin(plate_index, m_plate_data.size(), bed_w, bed_d)
            : Slic3r::Vec3d(0., 0., 0.);
        Slic3r::Polygon bed;
        for (const auto& point : config.opt<Slic3r::ConfigOptionPoints>("printable_area")->values)
            bed.points.push_back(Slic3r::Point::new_scale(point.x(), point.y()));

        // Cooperative cancellation while projecting bed containment: between
        // instances/volumes and inside the slab projection itself.
        auto throw_on_cancel = [this]() {
            std::lock_guard<std::mutex> lock(m_cancel_mutex);
            if (m_cancel_requested)
                throw Slic3r::CanceledException();
        };

        {
            std::lock_guard<std::mutex> lock(m_progress_mutex);
            m_progress_job_id = jobId;
            m_progress_percent = 0;
            m_progress_text = "Checking bed boundaries";
        }

        for (size_t oi = 0; oi < m_model.objects.size(); ++oi) {
            auto* mo = m_model.objects[oi];
            bool any_printable = false;
            for (size_t ii = 0; ii < mo->instances.size(); ++ii) {
                throw_on_cancel();
                bool is_on_plate = true;
                for (const auto* volume : mo->volumes) {
                    throw_on_cancel();
                    if (!volume->is_model_part()) continue;
                    Slic3r::Transform3d transform = mo->instances[ii]->get_matrix() * volume->get_matrix();
                    transform.translation() -= origin;
                    const auto footprint = Slic3r::project_mesh(volume->mesh().its, transform, throw_on_cancel);
                    throw_on_cancel();
                    if (!Slic3r::diff(footprint, Slic3r::Polygons{bed}).empty()) {
                        is_on_plate = false;
                        break;
                    }
                    throw_on_cancel();
                }
                mo->instances[ii]->printable = mo->printable && mo->instances[ii]->printable && is_on_plate;
                if (mo->instances[ii]->printable) any_printable = true;
            }
            mo->printable = any_printable;
        }
    } catch (const Slic3r::CanceledException&) {
        return json{
            {"ok", false},
            {"canceled", true},
            {"error", "canceled"}
        }.dump();
    }

    Slic3r::Print print;
    if (plate_index >= 0) {
        double bed_w = 256.0, bed_d = 256.0, bed_h = 256.0;
        OrcaEngine::getBedDimensions(config, bed_w, bed_d, bed_h);
        size_t total_plates = std::max(static_cast<size_t>(plate_index + 1), m_plate_data.size());
        if (total_plates == 0) total_plates = 1;
        Slic3r::Vec3d plate_origin = OrcaEngine::computePlateOrigin(plate_index, total_plates, bed_w, bed_d);
        print.set_plate_origin(plate_origin);
        print.set_plate_index(plate_index);
    }

    for (Slic3r::ModelObject *mo : m_model.objects) {
        if (!mo->printable) continue;
        mo->ensure_on_bed();
        print.auto_assign_extruders(mo);
    }
    print.is_BBL_printer() = m_bundle->is_bbl_vendor();
    print.set_calib_params(m_calib_params);
    print.apply(m_model, config);
    if (print.empty())
        throw Slic3r::SlicingError("The print is empty. The model is not printable with current print settings.");
    if (auto err = print.validate(); !err.string.empty())
        throw Slic3r::RuntimeError("Print validation failed: " + err.string);

    print.set_status_callback([this, jobId](const Slic3r::PrintBase::SlicingStatus& status) {
        std::lock_guard<std::mutex> lock(m_progress_mutex);
        m_progress_job_id = jobId;
        m_progress_percent = status.percent;
        m_progress_text = status.text;
    });

    {
        std::lock_guard<std::mutex> lock(m_cancel_mutex);
        if (m_cancel_requested) {
            m_cancel_requested = false;
            return json{
                {"ok", false},
                {"canceled", true},
                {"error", "canceled"}
            }.dump();
        }
        m_current_print = &print;
    }

    auto do_slice_body = [&]() -> std::string {
        try {
            print.process();
            Slic3r::GCodeProcessorResult proc_result;
            // The browser preview reparses the exported file; retain estimates without preview interpolation.
            std::string final_gcode = print.export_gcode(out_path, &proc_result, nullptr, false);
            std::string final_path = final_gcode.empty() ? out_path : final_gcode;
            uintmax_t gcode_size = std::filesystem::file_size(final_path);

            size_t layer_count = 0;
            for (const auto *obj : print.objects())
                layer_count = std::max(layer_count, obj->total_layer_count());

            float print_time = proc_result.print_statistics.modes[static_cast<size_t>(Slic3r::PrintEstimatedStatistics::ETimeMode::Normal)].time;
            const auto& stats = print.print_statistics();

            std::vector<std::string> warnings;
            for (const auto& w : proc_result.warnings) {
                warnings.push_back(w.msg);
            }

            {
                std::lock_guard<std::mutex> lock(m_cancel_mutex);
                m_current_print = nullptr;
            }
            {
                std::lock_guard<std::mutex> lock(m_progress_mutex);
                m_progress_job_id = 0;
                m_progress_percent = 0;
                m_progress_text.clear();
            }

            return json{
                {"ok", true},
                {"result", {
                    {"gcodePath", final_path},
                    {"gcodeBytes", gcode_size},
                    {"layers", layer_count},
                    {"printTimeS", print_time},
                    {"filamentMm", stats.total_used_filament},
                    {"filamentG", stats.total_weight},
                    {"warnings", warnings}
                }}
            }.dump();
        } catch (const Slic3r::CanceledException&) {
            {
                std::lock_guard<std::mutex> lock(m_cancel_mutex);
                m_current_print = nullptr;
            }
            {
                std::lock_guard<std::mutex> lock(m_progress_mutex);
                m_progress_job_id = 0;
                m_progress_percent = 0;
                m_progress_text.clear();
            }
            return json{
                {"ok", false},
                {"canceled", true},
                {"error", "canceled"}
            }.dump();
        } catch (...) {
            {
                std::lock_guard<std::mutex> lock(m_cancel_mutex);
                m_current_print = nullptr;
            }
            {
                std::lock_guard<std::mutex> lock(m_progress_mutex);
                m_progress_job_id = 0;
                m_progress_percent = 0;
                m_progress_text.clear();
            }
            throw;
        }
    };

    if (threads > 0) {
        tbb::task_arena arena(threads);
        return arena.execute(do_slice_body);
    } else {
        return do_slice_body();
    }
}

Engine::Engine() : m_impl(std::make_unique<Impl>()) {}
Engine::~Engine() = default;

int Engine::submit(const std::string& op, const std::string& argsJson) {
    return m_impl->submit(op, argsJson);
}

std::string Engine::poll(int jobId) {
    return m_impl->poll(jobId);
}

std::string Engine::progress() {
    return m_impl->progress();
}

void Engine::cancel() {
    m_impl->cancel();
}

json Engine::Impl::op_setupCalibration(const json& args) {
    if (!m_bundle)
        throw Slic3r::RuntimeError("Preset bundle not initialized");
    return OrcaWasm::setupCalibration(m_model, m_options_override, *m_bundle, m_calib_params, args, m_resources_dir);
}

json Engine::Impl::op_autoOrient(const json& args) { return OrcaWasm::autoOrient(m_model, args); }
json Engine::Impl::op_getPlanarFacets(const json& args) { return OrcaWasm::getPlanarFacets(m_model, args); }
json Engine::Impl::op_placeOnFace(const json& args) { return OrcaWasm::placeOnFace(m_model, args); }
json Engine::Impl::op_splitObject(const json& args) { return OrcaWasm::splitObject(m_model, args); }
json Engine::Impl::op_splitVolume(const json& args) { return OrcaWasm::splitVolume(m_model, args); }
json Engine::Impl::op_simplifyVolume(const json& args) { return OrcaWasm::simplifyVolume(m_model, args); }
json Engine::Impl::op_meshBoolean(const json& args) { return OrcaWasm::meshBoolean(m_model, args); }
json Engine::Impl::op_addSvg(const json& args) { return OrcaWasm::addSvg(m_model, args); }
json Engine::Impl::op_updateSvg(const json& args) { return OrcaWasm::updateSvg(m_model, args); }
json Engine::Impl::op_getSvg(const json& args) { return OrcaWasm::getSvg(m_model, args); }
json Engine::Impl::op_getBrimEars(const json& args) { return OrcaWasm::getBrimEars(m_model, args); }
json Engine::Impl::op_setBrimEars(const json& args) { return OrcaWasm::setBrimEars(m_model, args); }
json Engine::Impl::op_clearBrimEars(const json& args) { return OrcaWasm::clearBrimEars(m_model, args); }


json Engine::Impl::op_getOption(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const std::string key = args.at("key").get<std::string>();
    if (!Slic3r::print_config_def.has(key)) throw Slic3r::RuntimeError("Unknown option key");

    if (args.contains("filamentIndex") && !args.at("filamentIndex").is_null()) {
        if (!args.at("filamentIndex").is_number_integer() || args.at("filamentIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid filament index");
        }
    }
    if (args.contains("layoutIndex") && !args.at("layoutIndex").is_null()) {
        if (!args.at("layoutIndex").is_number_integer() || args.at("layoutIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid layout index");
        }
    }

    const Slic3r::DynamicPrintConfig base_config = m_bundle->full_config();
    const auto* colours_bundle = base_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    const size_t total_slots = colours_bundle ? colours_bundle->values.size() : (m_selected_filaments.empty() ? 1 : m_selected_filaments.size());

    const bool project_slot = args.contains("filamentIndex") && !args.at("filamentIndex").is_null();
    const size_t slot = project_slot ? args.at("filamentIndex").get<size_t>() : 0;
    const bool has_layout = args.contains("layoutIndex") && !args.at("layoutIndex").is_null();
    const size_t layout_idx = has_layout ? args.at("layoutIndex").get<size_t>() : 0;

    if (project_slot && slot >= total_slots) {
        throw Slic3r::RuntimeError("Invalid filament index");
    }

    if (project_slot && key != "filament_colour") {
        const auto& filament_keys = Slic3r::Preset::filament_options();
        if (std::find(filament_keys.begin(), filament_keys.end(), key) == filament_keys.end()) {
            throw Slic3r::RuntimeError("Not a filament key");
        }
    }

    // Baseline or current option resolution
    std::unique_ptr<Slic3r::ConfigOption> source_holder;
    const Slic3r::ConfigOption* source = nullptr;

    if (args.contains("serializedValue") && !args.at("serializedValue").is_null()) {
        json errors = json::array();
        const auto normalized = normalize_options(json{{key, args.at("serializedValue")}}, errors);
        if (has_fatal_errors(errors)) throw Slic3r::RuntimeError("Invalid serialized option value");
        if (const auto* option = normalized.option(key)) {
            source_holder.reset(option->clone());
            source = source_holder.get();
        }
    } else {
        const bool baseline = args.value("baseline", false);
        Slic3r::DynamicPrintConfig config = m_bundle->full_config();
        if (!baseline) {
            config.apply(m_options_override);
        }
        const auto* opt = config.option(key);
        if (opt) {
            source_holder.reset(opt->clone());
            source = source_holder.get();
        }
    }

    if (!source) return json{{"value", ""}};

    const auto* vector = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(source);

    if (!vector) {
        if (project_slot && slot >= total_slots) throw Slic3r::RuntimeError("Invalid filament index");
        if (has_layout && layout_idx > 0) throw Slic3r::RuntimeError("Invalid layout index");
        if (const auto* text = dynamic_cast<const Slic3r::ConfigOptionString*>(source))
            return json{{"value", text->value}};
        return json{{"value", source->serialize()}};
    }


    const size_t stride = (vector->size() >= total_slots && vector->size() % total_slots == 0) ? (vector->size() / total_slots) : vector->size();
    if (has_layout) {
        if (project_slot && layout_idx >= stride) throw Slic3r::RuntimeError("Invalid layout index");
        if (!project_slot && layout_idx >= vector->size()) throw Slic3r::RuntimeError("Invalid layout index");
    }

    std::unique_ptr<Slic3r::ConfigOption> value(source->clone());

    if (project_slot) {
        const size_t start = (vector->size() >= total_slots && vector->size() % total_slots == 0) ? slot * stride : 0;
        static_cast<Slic3r::ConfigOptionVectorBase*>(value.get())->set(source, start, stride);
    }

    if (has_layout) {
        auto* val_vec = dynamic_cast<Slic3r::ConfigOptionVectorBase*>(value.get());
        if (val_vec && layout_idx < val_vec->size()) {
            std::unique_ptr<Slic3r::ConfigOption> single(val_vec->clone());
            static_cast<Slic3r::ConfigOptionVectorBase*>(single.get())->set(val_vec, layout_idx, 1);
            if (auto* strvec = dynamic_cast<Slic3r::ConfigOptionStrings*>(single.get())) {
                if (!strvec->values.empty()) return json{{"value", strvec->values[0]}};
            }
            return json{{"value", single->serialize()}};
        } else {
            return json{{"value", ""}};
        }
    }

    if (auto* strvec = dynamic_cast<Slic3r::ConfigOptionStrings*>(value.get())) {
        if (strvec->values.size() == 1) return json{{"value", strvec->values[0]}};
        if (strvec->values.empty()) return json{{"value", ""}};
    }

    return json{{"value", value->serialize()}};
}

json Engine::Impl::op_setOption(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized");
    const std::string key = args.at("key").get<std::string>();
    if (!Slic3r::print_config_def.has(key)) throw Slic3r::RuntimeError("Unknown option key");

    if (args.contains("filamentIndex") && !args.at("filamentIndex").is_null()) {
        if (!args.at("filamentIndex").is_number_integer() || args.at("filamentIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid filament index");
        }
    }
    if (args.contains("layoutIndex") && !args.at("layoutIndex").is_null()) {
        if (!args.at("layoutIndex").is_number_integer() || args.at("layoutIndex").get<int64_t>() < 0) {
            throw Slic3r::RuntimeError("Invalid layout index");
        }
    }

    const Slic3r::DynamicPrintConfig base_config = m_bundle->full_config();
    const auto* colours_bundle = base_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    const size_t total_slots = colours_bundle ? colours_bundle->values.size() : (m_selected_filaments.empty() ? 1 : m_selected_filaments.size());

    const bool project_slot = args.contains("filamentIndex") && !args.at("filamentIndex").is_null();
    const size_t slot = project_slot ? args.at("filamentIndex").get<size_t>() : 0;
    const bool has_layout = args.contains("layoutIndex") && !args.at("layoutIndex").is_null();
    const size_t layout_idx = has_layout ? args.at("layoutIndex").get<size_t>() : 0;

    if (project_slot && slot >= total_slots) {
        throw Slic3r::RuntimeError("Invalid filament index");
    }

    if (project_slot && key != "filament_colour") {
        const auto& filament_keys = Slic3r::Preset::filament_options();
        if (std::find(filament_keys.begin(), filament_keys.end(), key) == filament_keys.end()) {
            throw Slic3r::RuntimeError("Not a filament key");
        }
    }

    std::string sval;
    auto& val = args.at("value");
    if (val.is_string()) sval = val.get<std::string>();
    else if (val.is_number_float()) sval = Slic3r::float_to_string_decimal_point(val.get<double>());
    else if (val.is_number()) sval = val.dump();
    else if (val.is_boolean()) sval = val.get<bool>() ? "1" : "0";
    else if (val.is_null()) sval = "";

    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    const auto* source = config.option(key);
    if (!source) throw Slic3r::RuntimeError("Option not found in config");
    if (!valid_numeric_option(*source, sval))
        return json{{"success", false}, {"error", "Invalid numeric option value"}};

    const auto* vector = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(source);

    if (!vector) {
        if (project_slot && slot >= total_slots) throw Slic3r::RuntimeError("Invalid filament index");
        if (has_layout && layout_idx > 0) throw Slic3r::RuntimeError("Invalid layout index");
        if (dynamic_cast<const Slic3r::ConfigOptionString*>(source)) {
            // UI text is literal; serialized profile strings still use setOptions.
            m_options_override.set_key_value(key, new Slic3r::ConfigOptionString(sval));
            return json{{"success", true}};
        }
        try {
            m_options_override.set_deserialize_strict(key, sval);
            return json{{"success", true}};
        } catch (const std::exception& e) {
            return json{{"success", false}, {"error", e.what()}};
        }
    }

    if (!project_slot && !has_layout) {
        try {
            m_options_override.set_deserialize_strict(key, sval);
            return json{{"success", true}};
        } catch (const std::exception& e) {
            return json{{"success", false}, {"error", e.what()}};
        }
    }


    const size_t stride = (vector->size() >= total_slots && vector->size() % total_slots == 0) ? (vector->size() / total_slots) : vector->size();
    if (has_layout) {
        if (project_slot && layout_idx >= stride) throw Slic3r::RuntimeError("Invalid layout index");
        if (!project_slot && layout_idx >= vector->size()) throw Slic3r::RuntimeError("Invalid layout index");
    }

    std::unique_ptr<Slic3r::ConfigOption> new_full(source->clone());
    auto* new_full_vec = static_cast<Slic3r::ConfigOptionVectorBase*>(new_full.get());
    const size_t start = (project_slot && vector->size() >= total_slots && vector->size() % total_slots == 0) ? slot * stride : 0;

    std::unique_ptr<Slic3r::ConfigOption> temp_val(source->clone());
    bool parsed = true;
    try {
        if (auto* str_temp = dynamic_cast<Slic3r::ConfigOptionStrings*>(temp_val.get())) {
            if (has_layout || (project_slot && stride == 1)) {
                str_temp->values.clear();
                str_temp->values.push_back(sval);
            } else {
                parsed = temp_val->deserialize(sval);
            }
        } else if (has_layout || (project_slot && stride == 1)) {
            // Deserialize scalar cell value into a temporary vector of size 1
            std::unique_ptr<Slic3r::ConfigOption> single_cell(source->clone());
            auto* single_vec = static_cast<Slic3r::ConfigOptionVectorBase*>(single_cell.get());
            if (single_vec->size() > 0) {
                single_vec->set(source, 0, 1);
            }
            parsed = single_cell->deserialize(sval);
            if (parsed) {
                temp_val = std::move(single_cell);
            }
        } else {
            parsed = temp_val->deserialize(sval);
        }
    } catch (const std::exception& e) {
        return json{{"success", false}, {"error", e.what()}};
    } catch (...) {
        return json{{"success", false}, {"error", "Failed to deserialize option " + key + ": invalid value"}};
    }

    if (!parsed) {
        return json{{"success", false}, {"error", "Failed to deserialize option " + key + ": invalid value"}};
    }

    auto* temp_vec = dynamic_cast<const Slic3r::ConfigOptionVectorBase*>(temp_val.get());
    if ((has_layout || (project_slot && stride == 1)) && temp_vec && temp_vec->size() != 1)
        return json{{"success", false}, {"error", "Expected one option value"}};

    if (has_layout) {
        if (start + layout_idx < new_full_vec->size()) {
            new_full_vec->set_at(temp_val.get(), start + layout_idx, 0);
        }
    } else if (project_slot) {
        if (temp_vec) {
            if (stride == 1 && temp_vec->size() == 1) {
                new_full_vec->set_at(temp_val.get(), start, 0);
            } else {
                for (size_t i = 0; i < stride && i < temp_vec->size(); ++i) {
                    if (start + i < new_full_vec->size()) {
                        new_full_vec->set_at(temp_val.get(), start + i, i);
                    }
                }
            }
        }
    }

    const auto* base_opt = base_config.option(key);
    if (base_opt && new_full->operator==(*base_opt)) {
        m_options_override.erase(key);
    } else {
        m_options_override.set_key_value(key, new_full->clone());
    }
    return json{{"success", true}};
}
