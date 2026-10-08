#include "Engine.hpp"
#include "ConfigRules.hpp"
#include "ProjectOps.hpp"
#include "ObjectOps.hpp"
#include "PlateOps.hpp"
#include "PaintOps.hpp"
#include "PaintToolsOps.hpp"
#include "LayerHeightOps.hpp"
#include "TextOps.hpp"
#include "CutOps.hpp"
#include "libslic3r/Arrange.hpp"

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
#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Thread.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"

#include <tbb/task_arena.h>

#include <boost/log/core.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/expressions.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cfloat>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

namespace {

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
    json op_selectPresets(const json& args);
    json op_getConfig(const json& args);
    json op_getConfigDef(const json& args);
    json op_evaluateRules(const json& args);
    json op_setOptions(const json& args);
    json op_resetOptions(const json& args);
    json op_loadModel(const json& args);
    json op_arrange(const json& args);
    json op_addModel(const json& args);
    json op_listObjects(const json& args);
    json op_getMesh(const json& args);
    json op_setInstanceTransform(const json& args);
    json op_deleteObject(const json& args);
    json op_duplicateInstance(const json& args);
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
    json op_listPlates(const json& args);
    json op_addPlate(const json& args);
    json op_deletePlate(const json& args);
    json op_setPlateConfig(const json& args);
    json op_getSupportPainting(const json& args);
    json op_setSupportPainting(const json& args);
    json op_clearSupportPainting(const json& args);
    json op_getSeamPainting(const json& args);
    json op_setSeamPainting(const json& args);
    json op_clearSeamPainting(const json& args);
    json op_cutObject(const json& args);
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
    json op_updateText(const json& args);
    json op_getText(const json& args);
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
    Slic3r::PlateDataPtrs m_plate_data;
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
        } else if (op == "selectPresets") {
            result_data = op_selectPresets(args);
        } else if (op == "getConfig") {
            result_data = op_getConfig(args);
        } else if (op == "getConfigDef") {
            result_data = op_getConfigDef(args);
        } else if (op == "evaluateRules") {
            result_data = op_evaluateRules(args);
        } else if (op == "setOptions") {
            result_data = op_setOptions(args);
        } else if (op == "resetOptions") {
            result_data = op_resetOptions(args);
        } else if (op == "loadModel") {
            result_data = op_loadModel(args);
        } else if (op == "addModel") {
            result_data = op_addModel(args);
        } else if (op == "listObjects") {
            result_data = op_listObjects(args);
        } else if (op == "getMesh") {
            result_data = op_getMesh(args);
        } else if (op == "setInstanceTransform") {
            result_data = op_setInstanceTransform(args);
        } else if (op == "deleteObject") {
            result_data = op_deleteObject(args);
        } else if (op == "duplicateInstance") {
            result_data = op_duplicateInstance(args);
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
        } else if (op == "listPlates") {
            result_data = op_listPlates(args);
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
        } else if (op == "cutObject") {
            result_data = op_cutObject(args);
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
        } else if (op == "addText") {
            result_data = op_addText(args);
        } else if (op == "updateText") {
            result_data = op_updateText(args);
        } else if (op == "getText") {
            result_data = op_getText(args);
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
    for (const auto& f : filament_names) {
        if (m_bundle->filaments.find_preset(f) == nullptr)
            throw Slic3r::RuntimeError("Unknown filament preset: " + f);
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

json Engine::Impl::op_getConfig(const json& /*args*/) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    if (config.opt_string("before_layer_change_gcode").empty() && config.opt_string("layer_change_gcode").empty()) {
        config.set_key_value("before_layer_change_gcode", new Slic3r::ConfigOptionString("G92 E0"));
    }

    json res = json::object();
    for (const std::string& key : config.keys()) {
        res[key] = config.opt_serialize(key);
    }
    return res;
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
    json errors_arr = json::array();
    if (args.contains("options") && args["options"].is_object()) {
        for (auto& [key, val] : args["options"].items()) {
            if (!Slic3r::print_config_def.has(key)) {
                errors_arr.push_back({{"key", key}, {"error", "Unknown option key"}});
                continue;
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
                m_options_override.set_deserialize_strict(key, sval);
            } catch (const std::exception& e) {
                errors_arr.push_back({{"key", key}, {"error", e.what()}});
            }
        }
    }
    return json{{"errors", errors_arr}};
}

json Engine::Impl::op_resetOptions(const json& /*args*/) {
    m_options_override.clear();
    return json::object();
}

json Engine::Impl::op_loadModel(const json& args) {
    std::string path = args.at("path").get<std::string>();
    m_model = Slic3r::Model::read_from_file(path, nullptr, nullptr, Slic3r::LoadStrategy::AddDefaultInstances | Slic3r::LoadStrategy::LoadModel);
    if (m_model.objects.empty())
        throw Slic3r::RuntimeError("No objects loaded from file: " + path);

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

json Engine::Impl::op_addModel(const json& args) {
    std::string path = args.at("path").get<std::string>();
    Slic3r::Model loaded_model = Slic3r::Model::read_from_file(path, nullptr, nullptr, Slic3r::LoadStrategy::AddDefaultInstances | Slic3r::LoadStrategy::LoadModel);
    if (loaded_model.objects.empty())
        throw Slic3r::RuntimeError("No objects loaded from file: " + path);

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
            instances_arr.push_back({
                {"id", inst->id().id},
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
    for (const Slic3r::ModelVolume* v : obj->volumes) {
        if (v && v->is_model_part()) {
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
    if (mesh.empty()) {
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
    std::string out_path = out_dir + "/mesh_" + std::to_string(object_id) + ".bin";

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

json Engine::Impl::op_arrange(const json& args) {
    if (m_model.objects.empty())
        throw Slic3r::RuntimeError("No model loaded");
    if (!m_bundle)
        throw Slic3r::RuntimeError("Preset bundle not initialized");

    Slic3r::DynamicPrintConfig config = m_bundle->full_config();
    config.apply(m_options_override);

    bool use_bed = args.value("useBed", false);

    Slic3r::BoundingBoxf bed_bbox;
    if (const auto *bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area");
        bed_shape_opt && !bed_shape_opt->values.empty()) {
        for (const auto &p : bed_shape_opt->values)
            bed_bbox.merge(p);
    }
    Slic3r::Vec2d bed_center = bed_bbox.defined ? bed_bbox.center() : Slic3r::Vec2d(100.0, 100.0);

    if (!use_bed) {
        m_model.center_instances_around_point(bed_center);
        Slic3r::arrange_objects(m_model, Slic3r::InfiniteBed{Slic3r::Point::new_scale(bed_center.x(), bed_center.y())},
                                Slic3r::ArrangeParams{Slic3r::scaled(Slic3r::min_object_distance(config))});
        return json::object();
    }

    Slic3r::ModelInstancePtrs instances;
    auto input = Slic3r::get_arrange_polys(m_model, instances);
    Slic3r::ArrangeParams params{Slic3r::scaled(Slic3r::min_object_distance(config))};
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
        if (bed_points.size() >= 3) {
            Slic3r::arrangement::arrange(input, bed_points, params);
        } else {
            m_model.center_instances_around_point(bed_center);
            Slic3r::arrangement::arrange(input, Slic3r::InfiniteBed{Slic3r::Point::new_scale(bed_center.x(), bed_center.y())}, params);
        }
    }

    Slic3r::apply_arrange_polys(input, instances, Slic3r::throw_if_out_of_bed);

    return json::object();
}

json Engine::Impl::op_openProject(const json& args) {
    if (!m_bundle) throw Slic3r::RuntimeError("Preset bundle not initialized; call loadVendors first");
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


std::string Engine::Impl::op_slice(int jobId, const json& args) {
    struct SliceCleanupGuard {
        Engine::Impl* impl;
        std::vector<std::pair<Slic3r::ModelObject*, std::vector<bool>>> saved_inst;
        std::vector<std::pair<Slic3r::ModelObject*, bool>> saved_obj;

        ~SliceCleanupGuard() {
            std::lock_guard<std::mutex> lock(impl->m_cancel_mutex);
            impl->m_current_print = nullptr;
            impl->m_cancel_requested = false;
            if (impl->m_slice_jobs_queued_or_running > 0) {
                impl->m_slice_jobs_queued_or_running--;
            }
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

    if (m_model.objects.empty())
        throw Slic3r::RuntimeError("No model loaded");
    if (!m_bundle)
        throw Slic3r::RuntimeError("Preset bundle not initialized");

    std::string out_path = args.at("outPath").get<std::string>();
    int threads = args.value("threads", 0);
    int plate_index = args.value("plateIndex", -1);

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

    if (plate_index >= 0) {
        for (auto* mo : m_model.objects) {
            slice_cleanup.saved_obj.emplace_back(mo, mo->printable);
            std::vector<bool> inst_p;
            inst_p.reserve(mo->instances.size());
            for (auto* inst : mo->instances) {
                inst_p.push_back(inst->printable);
            }
            slice_cleanup.saved_inst.emplace_back(mo, inst_p);
        }

        std::set<std::pair<int, int>> plate_pairs;
        if (static_cast<size_t>(plate_index) < m_plate_data.size()) {
            for (const auto& pair : m_plate_data[plate_index]->objects_and_instances) {
                plate_pairs.insert(pair);
            }
        }

        for (size_t oi = 0; oi < m_model.objects.size(); ++oi) {
            auto* mo = m_model.objects[oi];
            bool any_printable = false;
            for (size_t ii = 0; ii < mo->instances.size(); ++ii) {
                bool is_on_plate = plate_pairs.count({static_cast<int>(oi), static_cast<int>(ii)}) > 0;
                mo->instances[ii]->printable = is_on_plate;
                if (is_on_plate) any_printable = true;
            }
            mo->printable = any_printable;
        }
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
    print.apply(m_model, config);
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
            std::string final_gcode = print.export_gcode(out_path, &proc_result, nullptr);
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
