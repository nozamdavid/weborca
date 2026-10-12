#include "ProjectOps.hpp"
#include "PlateOps.hpp"

#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Utils.hpp"

#include <boost/filesystem.hpp>
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

namespace OrcaEngine {

nlohmann::json op_openProject(
    const nlohmann::json& args,
    Slic3r::Model& model,
    std::unique_ptr<Slic3r::PresetBundle>& bundle,
    Slic3r::DynamicPrintConfig& options_override,
    std::string& selected_printer,
    std::string& selected_process,
    std::vector<std::string>& selected_filaments,
    Slic3r::PlateDataPtrs& plate_data
) {
    if (!args.contains("path") || !args["path"].is_string()) {
        throw Slic3r::RuntimeError("openProject requires a string 'path' argument");
    }
    std::string path = args["path"].get<std::string>();
    if (!boost::filesystem::exists(path)) {
        throw Slic3r::RuntimeError("File not found: " + path);
    }

    Slic3r::DynamicPrintConfig config_loaded;
    Slic3r::ConfigSubstitutionContext config_substitutions{Slic3r::ForwardCompatibilitySubstitutionRule::Enable};
    Slic3r::PlateDataPtrs loaded_plate_data;
    std::vector<Slic3r::Preset*> project_presets;
    Slic3r::Semver file_version;
    Slic3r::En3mfType en_3mf_file_type = Slic3r::En3mfType::From_BBS;
    Slic3r::LoadStrategy strategy = Slic3r::LoadStrategy::LoadModel | Slic3r::LoadStrategy::LoadConfig | Slic3r::LoadStrategy::CheckVersion;

    Slic3r::Model loaded_model = Slic3r::Model::read_from_archive(
        path, &config_loaded, &config_substitutions, en_3mf_file_type, strategy,
        &loaded_plate_data, &project_presets, &file_version
    );

    if (loaded_model.objects.empty()) {
        throw Slic3r::RuntimeError("The supplied file couldn't be read because it's empty.");
    }

    model = std::move(loaded_model);

    nlohmann::json substitutions_json = nlohmann::json::array();
    for (const auto& subst : config_substitutions.substitutions) {
        substitutions_json.push_back({
            {"opt_key", subst.opt_def ? subst.opt_def->opt_key : ""},
            {"old_value", subst.old_value},
            {"new_value", subst.new_value ? subst.new_value->serialize() : ""}
        });
    }

    if (bundle && !project_presets.empty()) {
        Slic3r::PresetsConfigSubstitutions preset_substs = bundle->load_project_embedded_presets(project_presets, Slic3r::ForwardCompatibilitySubstitutionRule::Enable);
        for (const auto& psubst : preset_substs) {
            for (const auto& s : psubst.substitutions) {
                substitutions_json.push_back({
                    {"preset_name", psubst.preset_name},
                    {"opt_key", s.opt_def ? s.opt_def->opt_key : ""},
                    {"old_value", s.old_value},
                    {"new_value", s.new_value ? s.new_value->serialize() : ""}
                });
            }
        }
    }
    for (auto* p : project_presets) {
        delete p;
    }
    project_presets.clear();

    nlohmann::json warnings_json = nlohmann::json::array();
    if (bundle && !config_loaded.empty()) {
        Slic3r::DynamicPrintConfig config;
        config.apply(static_cast<const Slic3r::ConfigBase &>(Slic3r::FullPrintConfig::defaults()));
        config += std::move(config_loaded);
        std::map<std::string, std::string> validity = config.validate();
        for (const auto& kv : validity) {
            warnings_json.push_back({{"key", kv.first}, {"warning", kv.second}});
        }
        Slic3r::Preset::normalize(config);
        bundle->load_config_model(path, std::move(config), file_version);
        bundle->update_multi_material_filament_presets();
        bundle->update_compatible(Slic3r::PresetSelectCompatibleType::Never);

        selected_printer = bundle->printers.get_edited_preset().name;
        selected_process = bundle->prints.get_edited_preset().name;
        selected_filaments = bundle->filament_presets;

        if (bundle->printers.get_edited_preset().printer_technology() == Slic3r::ptFFF) {
            if (bundle->printers.get_edited_preset().config.has("default_bed_type") &&
                !bundle->printers.get_edited_preset().config.opt_string("default_bed_type").empty()) {
                Slic3r::BedType bed_type = bundle->printers.get_edited_preset().get_default_bed_type(bundle.get());
                bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(bed_type));
            } else {
                bundle->project_config.set_key_value("curr_bed_type", new Slic3r::ConfigOptionEnum<Slic3r::BedType>(Slic3r::btPC));
            }
        }
    }
    options_override.clear();

    // Populate objects_and_instances for loaded plates if not already populated
    for (auto* p : loaded_plate_data) {
        if (p->objects_and_instances.empty()) {
            if (!p->obj_inst_map.empty()) {
                for (const auto& item : p->obj_inst_map) {
                    int identify_id = item.second.second;
                    for (size_t oi = 0; oi < model.objects.size(); ++oi) {
                        for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                            if (model.objects[oi]->instances[ii]->loaded_id == identify_id) {
                                p->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
                            }
                        }
                    }
                }
            }
            if (p->objects_and_instances.empty()) {
                for (size_t oi = 0; oi < model.objects.size(); ++oi) {
                    for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                        p->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
                    }
                }
            }
        }
    }

    if (loaded_plate_data.empty()) {
        Slic3r::PlateData* p = new Slic3r::PlateData();
        p->plate_index = 0;
        p->plate_name = "Plate 1";
        for (size_t oi = 0; oi < model.objects.size(); ++oi) {
            for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                p->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
            }
        }
        loaded_plate_data.push_back(p);
    }

    Slic3r::release_PlateData_list(plate_data);
    plate_data = std::move(loaded_plate_data);

    // Build objects JSON
    nlohmann::json objects_arr = nlohmann::json::array();
    for (const auto* obj : model.objects) {
        Slic3r::Vec3d sz = obj->bounding_box_exact().size();
        nlohmann::json obj_json = {
            {"id", obj->id().id},
            {"name", obj->name},
            {"instances", obj->instances.size()},
            {"volumes", obj->volumes.size()},
            {"size", {sz.x(), sz.y(), sz.z()}}
        };

        int extruder_id = 0;
        if (const auto* ext_opt = dynamic_cast<const Slic3r::ConfigOptionInt*>(obj->config.option("extruder"))) {
            extruder_id = ext_opt->getInt();
        }
        obj_json["extruder"] = extruder_id;

        nlohmann::json cfg_json = nlohmann::json::object();
        for (const std::string& key : obj->config.keys()) {
            cfg_json[key] = obj->config.opt_serialize(key);
        }
        obj_json["config"] = cfg_json;

        nlohmann::json inst_arr = nlohmann::json::array();
        for (const auto* inst : obj->instances) {
            inst_arr.push_back({
                {"id", inst->id().id},
                {"offset", {inst->get_offset(Slic3r::X), inst->get_offset(Slic3r::Y), inst->get_offset(Slic3r::Z)}},
                {"rotation", {inst->get_rotation(Slic3r::X), inst->get_rotation(Slic3r::Y), inst->get_rotation(Slic3r::Z)}},
                {"scale", {inst->get_scaling_factor(Slic3r::X), inst->get_scaling_factor(Slic3r::Y), inst->get_scaling_factor(Slic3r::Z)}}
            });
        }
        obj_json["instancesDetail"] = inst_arr;

        nlohmann::json vol_arr = nlohmann::json::array();
        for (const auto* vol : obj->volumes) {
            int vol_extruder_id = 0;
            if (const auto* ve_opt = dynamic_cast<const Slic3r::ConfigOptionInt*>(vol->config.option("extruder"))) {
                vol_extruder_id = ve_opt->getInt();
            }
            nlohmann::json vcfg_json = nlohmann::json::object();
            for (const std::string& key : vol->config.keys()) {
                vcfg_json[key] = vol->config.opt_serialize(key);
            }
            vol_arr.push_back({
                {"id", vol->id().id},
                {"name", vol->name},
                {"type", static_cast<int>(vol->type())},
                {"extruder", vol_extruder_id},
                {"config", vcfg_json}
            });
        }
        obj_json["volumesDetail"] = vol_arr;

        objects_arr.push_back(obj_json);
    }

    // Build plates JSON
    nlohmann::json plates_arr = nlohmann::json::array();
    for (const auto* p : plate_data) {
        nlohmann::json p_json = nlohmann::json::object();
        p_json["index"] = p->plate_index;
        p_json["name"] = p->plate_name;
        p_json["locked"] = p->locked;
        p_json["filamentMaps"] = p->filament_maps;

        nlohmann::json inst_pairs = nlohmann::json::array();
        for (const auto& pair : p->objects_and_instances) {
            if (pair.first >= 0 && static_cast<size_t>(pair.first) < model.objects.size()) {
                const auto* o = model.objects[pair.first];
                if (pair.second >= 0 && static_cast<size_t>(pair.second) < o->instances.size()) {
                    const auto* i = o->instances[pair.second];
                    inst_pairs.push_back({
                        {"objectId", o->id().id},
                        {"instanceId", i->id().id}
                    });
                }
            }
        }
        p_json["instances"] = inst_pairs;

        nlohmann::json cfg_json = nlohmann::json::object();
        for (const std::string& key : p->config.keys()) {
            cfg_json[key] = p->config.opt_serialize(key);
        }
        p_json["config"] = cfg_json;

        plates_arr.push_back(p_json);
    }

    return nlohmann::json{
        {"objects", objects_arr},
        {"plates", plates_arr},
        {"selectedPresets", {
            {"printer", selected_printer},
            {"process", selected_process},
            {"filaments", selected_filaments}
        }},
        {"substitutions", substitutions_json},
        {"warnings", warnings_json}
    };
}

nlohmann::json op_saveProject(
    const nlohmann::json& args,
    Slic3r::Model& model,
    const std::unique_ptr<Slic3r::PresetBundle>& bundle,
    const Slic3r::DynamicPrintConfig& options_override,
    const Slic3r::PlateDataPtrs& plate_data
) {
    if (!args.contains("path") || !args["path"].is_string()) {
        throw Slic3r::RuntimeError("saveProject requires a string 'path' argument");
    }
    std::string path = args["path"].get<std::string>();
    if (model.objects.empty()) {
        throw Slic3r::RuntimeError("No model loaded");
    }
    // Undo snapshots and autosave trade some size for a much faster mesh compression.
    int compression_level = -1;
    if (args.contains("compressionLevel")) {
        const auto& level = args["compressionLevel"];
        // Compare before narrowing, so a large value cannot wrap into the range.
        // The archive writer streams the meshes, which needs a deflate level (1-10).
        const bool in_range = level.is_number_unsigned() ? level.get<uint64_t>() >= 1 && level.get<uint64_t>() <= 10 :
                              level.is_number_integer()  ? level.get<int64_t>() >= 1 && level.get<int64_t>() <= 10 : false;
        if (!in_range)
            throw Slic3r::RuntimeError("saveProject compressionLevel must be an integer between 1 and 10");
        compression_level = static_cast<int>(level.get<int64_t>());
    }

    boost::filesystem::path p(path);
    if (p.has_parent_path()) {
        boost::filesystem::create_directories(p.parent_path());
    }

    Slic3r::PlateDataPtrs store_plates;
    if (!plate_data.empty()) {
        for (const auto* pd : plate_data) {
            Slic3r::PlateData* np = new Slic3r::PlateData(*pd);
            if (np->objects_and_instances.empty()) {
                for (size_t oi = 0; oi < model.objects.size(); ++oi) {
                    for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                        np->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
                    }
                }
            }
            store_plates.push_back(np);
        }
    } else {
        Slic3r::PlateData* np = new Slic3r::PlateData();
        np->plate_index = 0;
        np->plate_name = "Plate 1";
        for (size_t oi = 0; oi < model.objects.size(); ++oi) {
            for (size_t ii = 0; ii < model.objects[oi]->instances.size(); ++ii) {
                np->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
            }
        }
        store_plates.push_back(np);
    }

    std::vector<Slic3r::Preset*> project_presets;
    if (bundle) {
        project_presets = bundle->get_current_project_embedded_presets();
    }

    Slic3r::DynamicPrintConfig cfg;
    if (bundle) {
        cfg = bundle->full_config_secure();
        cfg.apply(options_override);
        // Desktop imports only keys listed as differing from the base preset.
        // Web overrides live outside edited presets, so include them in that
        // standard metadata as well as in the serialized configuration.
        const size_t filament_count = bundle->filament_presets.size();
        auto* different = cfg.option<Slic3r::ConfigOptionStrings>("different_settings_to_system", true);
        different->values.resize(filament_count + 2);
        const auto append_overrides = [&](size_t index, const std::vector<std::string>& allowed) {
            std::vector<std::string> keys;
            Slic3r::unescape_strings_cstyle(different->values[index], keys);
            for (const auto& key : options_override.keys()) {
                if (std::find(allowed.begin(), allowed.end(), key) != allowed.end() &&
                    std::find(keys.begin(), keys.end(), key) == keys.end()) keys.push_back(key);
            }
            different->values[index] = Slic3r::escape_strings_cstyle(keys);
        };
        append_overrides(0, Slic3r::Preset::print_options());
        append_overrides(filament_count + 1, Slic3r::Preset::printer_options());
        for (size_t slot = 0; slot < filament_count; ++slot)
            append_overrides(slot + 1, Slic3r::Preset::filament_options());
    }

    // Object indices can change after deletion, reordering or replacing a
    // model. Rebuild the saved plate membership from the current instances.
    if (bundle) assignInstancesToPlates(model, store_plates, cfg);

    Slic3r::StoreParams store_params;
    store_params.path = path;
    store_params.model = &model;
    store_params.plate_data_list = store_plates;
    store_params.export_plate_idx = -1;
    store_params.project_presets = project_presets;
    store_params.config = bundle ? &cfg : nullptr;
    // The desktop Save project layout: each object in its own model file, which
    // also lets a reopen skip the full-archive Prusa format check.
    store_params.strategy = Slic3r::SaveStrategy::Zip64 | Slic3r::SaveStrategy::SplitModel | Slic3r::SaveStrategy::ShareMesh;
    store_params.model_compression_level = compression_level;

    bool ok = Slic3r::store_bbs_3mf(store_params);

    Slic3r::release_PlateData_list(store_plates);
    for (auto* pr : project_presets) {
        delete pr;
    }
    project_presets.clear();

    if (!ok) {
        throw Slic3r::RuntimeError("Failed to save project to " + path);
    }

    return nlohmann::json{{"path", path}};
}

} // namespace OrcaEngine
