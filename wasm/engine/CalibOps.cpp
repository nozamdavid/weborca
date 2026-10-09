
#include "CalibOps.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/calib.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Arrange.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include <nlohmann/json.hpp>
#include <cmath>
#include <algorithm>

using json = nlohmann::json;

namespace OrcaWasm {

static void set_object_config(Slic3r::ModelConfigObject& config, const std::string& key, const std::string& value) {
    Slic3r::DynamicPrintConfig tmp;
    tmp.set_deserialize_strict(key, value);
    if (tmp.has(key)) {
        config.set_key_value(key, tmp.option(key)->clone());
    }
}


static void zero_pressure_advance_where_disabled(Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle)
{
    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    auto enable_pa   = current_config.option<Slic3r::ConfigOptionBools>("enable_pressure_advance");
    auto pa          = current_config.option<Slic3r::ConfigOptionFloats>("pressure_advance");
    auto adaptive_pa = current_config.option<Slic3r::ConfigOptionBools>("adaptive_pressure_advance");
    if (!enable_pa || !pa || !adaptive_pa || pa->empty() || adaptive_pa->empty())
        return;

    auto new_enable_pa = new Slic3r::ConfigOptionBools(*enable_pa);
    auto new_pa = new Slic3r::ConfigOptionFloats(*pa);
    auto new_adaptive_pa = new Slic3r::ConfigOptionBools(*adaptive_pa);

    if (new_pa->size() < new_enable_pa->size())
        new_pa->resize(new_enable_pa->size());
    if (new_adaptive_pa->size() < new_enable_pa->size())
        new_adaptive_pa->resize(new_enable_pa->size());
    for (size_t variant = 0; variant < new_enable_pa->size(); ++variant) {
        if (new_enable_pa->get_at(variant))
            continue;
        new_enable_pa->values[variant]   = true;
        new_pa->values[variant]          = 0.0;
        new_adaptive_pa->values[variant] = false;
    }
    options_override.set_key_value("enable_pressure_advance", new_enable_pa);
    options_override.set_key_value("pressure_advance", new_pa);
    options_override.set_key_value("adaptive_pressure_advance", new_adaptive_pa);
}

static void cut_horizontal_local(Slic3r::Model& model, size_t obj_idx, size_t instance_idx, double z, Slic3r::ModelObjectCutAttributes attributes) {
    if (obj_idx >= model.objects.size()) return;
    auto *object = model.objects[obj_idx];
    if (instance_idx >= object->instances.size()) return;
    if (!attributes.has(Slic3r::ModelObjectCutAttribute::KeepUpper) && !attributes.has(Slic3r::ModelObjectCutAttribute::KeepLower))
        return;
    const Slic3r::Vec3d instance_offset = object->instances[instance_idx]->get_offset();
    Slic3r::Cut cut(object, instance_idx, Slic3r::Geometry::translation_transform(z * Slic3r::Vec3d::UnitZ() - instance_offset), attributes);
    const auto new_objects = cut.perform_with_plane();
    model.delete_object(model.objects[obj_idx]->id());
    for (auto obj : new_objects) {
        model.add_object(*obj); }
}

static bool add_model_from_args(Slic3r::Model& model, const json& args, const std::string& drc_name) {
    if (!args.contains("meshes") || !args["meshes"].contains(drc_name))
        return false;
    std::string path = args["meshes"][drc_name].get<std::string>();
    try {
        Slic3r::Model loaded = Slic3r::Model::read_from_file(path); for (auto obj : loaded.objects) {
            Slic3r::ModelObject* new_obj = model.add_object(*obj);
            if (new_obj->instances.empty()) new_obj->add_instance();
            new_obj->center_around_origin();
            new_obj->ensure_on_bed(false);
        }
        return true;
    } catch (...) {
        return false;
    }
}

static Slic3r::ModelObject* add_cube_to_model(Slic3r::Model& model) {
    Slic3r::ModelObject* cube = model.add_object();
    cube->name = "Cube";
    Slic3r::ModelVolume* vol = cube->add_volume(Slic3r::make_cube(25.0, 25.0, 25.0));
    vol->name = "Cube";
    cube->add_instance();
    return cube;
}


static void calib_pa_line(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    add_model_from_args(model, args, "pressure_advance_test.drc"); }

static void _calib_pa_tower(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    if (!add_model_from_args(model, args, "tower_with_seam.drc"))
        return;

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);

    const double nozzle_diameter = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter")->get_at(0);

    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");
    options_override.set_key_value("slow_down_layer_time", new Slic3r::ConfigOptionFloats{ 1.0f });

    auto& obj_cfg = model.objects[0]->config;
    set_object_config(obj_cfg, "alternate_extra_wall", (false) ? "1" : "0");
    set_object_config(obj_cfg, "seam_position", "back");
    set_object_config(obj_cfg, "wall_loops", std::to_string(2));
    set_object_config(obj_cfg, "top_shell_layers", std::to_string(0));
    set_object_config(obj_cfg, "bottom_shell_layers", std::to_string(0));
    set_object_config(obj_cfg, "sparse_infill_density", std::to_string(0.0) + "%");
    set_object_config(obj_cfg, "brim_type", "brim_ears");
    set_object_config(obj_cfg, "brim_object_gap", std::to_string(.0f));
    set_object_config(obj_cfg, "brim_ears_max_angle", std::to_string(135.f));
    set_object_config(obj_cfg, "brim_width", std::to_string(6.f));
    set_object_config(obj_cfg, "seam_slope_type", "none");
    options_override.set_deserialize_strict("max_volumetric_extrusion_rate_slope", std::to_string(0));

    auto new_height = std::ceil((params.end - params.start) / params.step) + 1;
    auto obj_bb = model.objects[0]->bounding_box_exact();
    if (new_height < obj_bb.size().z()) {
        cut_horizontal_local(model, 0, 0, new_height, Slic3r::ModelObjectCutAttribute::KeepLower);
    }
}

static void _calib_pa_pattern(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    std::vector<double> speeds{params.speeds};
    std::vector<double> accels{params.accelerations};

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);
    
    double nozzle_diameter = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter")->get_at(0);

    options_override.set_deserialize_strict("filament_retract_when_changing_layer", (false) ? "1" : "0");
    options_override.set_deserialize_strict("filament_wipe", (false) ? "1" : "0");
    options_override.set_key_value("wipe", new Slic3r::ConfigOptionBools({false}));
    options_override.set_key_value("retract_when_changing_layer", new Slic3r::ConfigOptionBools({false}));
    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); auto accel = current_config.get_abs_value_at("outer_wall_acceleration", params.extruder_id);
    if (accel == 0)
        accel = current_config.get_abs_value_at("inner_wall_acceleration", params.extruder_id);
    if (accel == 0)
        accel = current_config.get_abs_value_at("default_acceleration", params.extruder_id);

    if (accels.empty()) {
        accels.assign({accel});
    } else {
        accel = *std::max_element(accels.begin(), accels.end());
    }
    options_override.set_deserialize_strict("outer_wall_acceleration", std::to_string(accel));
    options_override.set_deserialize_strict("print_sequence", "by layer");
    
    bool has_junc = current_config.has("default_junction_deviation") && current_config.option<Slic3r::ConfigOptionFloatsNullable>("default_junction_deviation")->values.size() > 0 && current_config.option<Slic3r::ConfigOptionFloatsNullable>("default_junction_deviation")->values[0] > 0;
    if(!has_junc && current_config.get_abs_value_at("default_jerk", params.extruder_id) > 0){
        auto jerk = current_config.get_abs_value_at("outer_wall_jerk", params.extruder_id);
        if (jerk == 0)
            jerk = current_config.get_abs_value_at("inner_wall_jerk", params.extruder_id);
        if (jerk == 0)
            jerk = current_config.get_abs_value_at("default_jerk", params.extruder_id);
        
        options_override.set_deserialize_strict("default_jerk", std::to_string(jerk));
        options_override.set_deserialize_strict("outer_wall_jerk", std::to_string(jerk));
        options_override.set_deserialize_strict("inner_wall_jerk", std::to_string(jerk));
        options_override.set_deserialize_strict("top_surface_jerk", std::to_string(jerk));
        options_override.set_deserialize_strict("infill_jerk", std::to_string(jerk));
        options_override.set_deserialize_strict("travel_jerk", std::to_string(jerk));
    }

    if (current_config.has("default_junction_deviation")){
        options_override.set_deserialize_strict("default_junction_deviation", std::to_string(0));
    }
    
    for (const auto& opt : Slic3r::SuggestedConfigCalibPAPattern().floats_pairs) {
        options_override.set_key_value(opt.first, new Slic3r::ConfigOptionFloatsNullable({opt.second[0]}));
    }
    for (const auto& opt : Slic3r::SuggestedConfigCalibPAPattern().nozzle_ratio_pairs) {
        options_override.set_key_value(opt.first, new Slic3r::ConfigOptionFloatOrPercent(nozzle_diameter * opt.second / 100, false));
    }
    for (const auto& opt : Slic3r::SuggestedConfigCalibPAPattern().int_pairs) {
        options_override.set_key_value(opt.first, new Slic3r::ConfigOptionInt(opt.second));
    }
    options_override.set_key_value(Slic3r::SuggestedConfigCalibPAPattern().brim_pair.first,
        new Slic3r::ConfigOptionEnum<Slic3r::BrimType>(Slic3r::SuggestedConfigCalibPAPattern().brim_pair.second));
    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");

    if (speeds.empty()) {
        double speed = 100.0;
// current_config,
//             current_config.get_abs_value("line_width", nozzle_diameter),
//             current_config.get_abs_value("layer_height"), 0, 0);
        options_override.set_deserialize_strict("outer_wall_speed", std::to_string(speed));
        speeds.assign({speed});
    } else if (speeds.size() == 1) {
        options_override.set_deserialize_strict("outer_wall_speed", std::to_string(speeds.front()));
    }

    current_config.apply(options_override, true);
    const bool is_bbl_machine = preset_bundle.is_bbl_vendor();

    auto *cube = add_cube_to_model(model);

    Slic3r::CalibPressureAdvancePattern pa_pattern(
        params,
        current_config,
        is_bbl_machine,
        *cube,
        Slic3r::Vec3d::Zero()
    );

    auto cube_bb = cube->raw_bounding_box();
    cube->scale((pa_pattern.print_size_x() + 4) / cube_bb.size().x(),
                (pa_pattern.print_size_y() + 4) / cube_bb.size().y(),
                pa_pattern.max_layer_z() / cube_bb.size().z());

    Slic3r::arrangement::ArrangePolygons arranged_items;
    {
        Slic3r::arrangement::ArrangeParams ap;
        Slic3r::Points bedpts = Slic3r::arrangement::get_shrink_bedpts(&current_config, ap);

        for(size_t i = 0; i < speeds.size() * accels.size(); i++) {
            Slic3r::arrangement::ArrangePolygon p;
            cube->instances[0]->get_arrange_polygon(&p);
            p.bed_idx = 0;
            arranged_items.emplace_back(p);
        }

        Slic3r::arrangement::arrange(arranged_items, bedpts, ap);
    }

    cube_bb = cube->raw_bounding_box();
    cube->scale(pa_pattern.handle_xy_size() / cube_bb.size().x(),
                pa_pattern.handle_xy_size() / cube_bb.size().y(),
                pa_pattern.max_layer_z() / cube_bb.size().z());

    for(size_t test_idx = 0; test_idx < arranged_items.size(); test_idx++) {
        const auto &ai = arranged_items[test_idx];
        auto tspd = speeds[test_idx % speeds.size()];
        auto tacc = accels[test_idx / speeds.size()];

        auto obj = (test_idx == 0) ? cube : model.add_object(*cube);
        obj->name = std::string("pa_pattern_") + std::to_string(int(tspd)) + std::string("_") + std::to_string(int(tacc));

        auto &obj_config = obj->config;
        if (speeds.size() > 1)
            set_object_config(obj_config, "outer_wall_speed", std::to_string(tspd));
        if (accels.size() > 1)
            set_object_config(obj_config, "outer_wall_acceleration", std::to_string(tacc));

        const Slic3r::Vec3d obj_offset{Slic3r::unscale<double>(ai.translation(Slic3r::X)),
                                       Slic3r::unscale<double>(ai.translation(Slic3r::Y)),
                                       0};
        obj->instances[0]->set_offset(obj_offset + pa_pattern.handle_pos_offset());
        obj->ensure_on_bed();
    }

    model.calib_pa_pattern = std::make_unique<Slic3r::CalibPressureAdvancePattern>(pa_pattern);
    
    // Custom GCode Gen
    std::vector<Slic3r::CustomGCode::Info> mgc;
    for (auto obj : model.objects) {
        auto gcode = model.calib_pa_pattern->generate_custom_gcodes(
                    current_config,
                                is_bbl_machine,
                                *obj,
                                Slic3r::Vec3d::Zero()
        );
        mgc.emplace_back(gcode);
    }
    
    auto &pcgc = model.plates_custom_gcodes[0];
    pcgc = std::move(mgc[0]);
    mgc.erase(mgc.begin());
    for (size_t i = 0; i < pcgc.gcodes.size(); i++) {
        for (auto &gc : mgc) {
            pcgc.gcodes[i].extra += gc.gcodes[i].extra;
        }
    }
}

static void calib_pa(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    options_override.set_deserialize_strict("overhang_reverse", (false) ? "1" : "0");
    options_override.set_deserialize_strict("precise_z_height", (false) ? "1" : "0");
    options_override.set_deserialize_strict("wipe_inward", (false) ? "1" : "0");
    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); switch (params.mode) {
        case Slic3r::CalibMode::Calib_PA_Line:
            calib_pa_line(model, options_override, preset_bundle, params, args); break;
        case Slic3r::CalibMode::Calib_PA_Pattern:
            _calib_pa_pattern(model, options_override, preset_bundle, params, args); break;
        case Slic3r::CalibMode::Calib_PA_Tower:
            _calib_pa_tower(model, options_override, preset_bundle, params, args); break;
        default: break;
    }
}

static void calib_temp(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    constexpr double base_temp_tower_nozzle_diameter = 0.4;
    constexpr double base_temp_tower_block_height = 10.0;
    constexpr int base_temp_tower_temp_step = 5;

    if (params.mode != Slic3r::CalibMode::Calib_Temp_Tower) return;
    
    if (!add_model_from_args(model, args, "temperature_tower.drc")) return;

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);

    auto start_temp = std::lround(params.start);
    const Slic3r::ConfigOptionFloats* nozzle_diameter_config = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter");
    size_t nozzle_id = static_cast<size_t>(std::max(params.extruder_id, 0));
    double nozzle_diameter = base_temp_tower_nozzle_diameter;
    if (nozzle_diameter_config && !nozzle_diameter_config->values.empty()) {
        nozzle_id = std::min(nozzle_id, nozzle_diameter_config->values.size() - 1);
        nozzle_diameter = nozzle_diameter_config->values[nozzle_id];
    }
    if (nozzle_diameter <= 0.0)
        nozzle_diameter = base_temp_tower_nozzle_diameter;

    const double nozzle_scale = nozzle_diameter / base_temp_tower_nozzle_diameter;
    const double block_height = base_temp_tower_block_height;

    auto obj_bb = model.objects[0]->bounding_box_exact();
    auto block_count = std::lround((500 - params.end) / base_temp_tower_temp_step + 1);
    if (block_count > 0) {
        auto new_height = block_count * block_height - EPSILON;
        if (new_height < obj_bb.size().z()) {
            cut_horizontal_local(model, 0, 0, new_height, Slic3r::ModelObjectCutAttribute::KeepLower);
        }
    }

    obj_bb = model.objects[0]->bounding_box_exact();
    block_count = std::lround((500 - params.start) / base_temp_tower_temp_step);
    if (block_count > 0) {
        auto new_height = block_count * block_height + EPSILON;
        if (new_height < obj_bb.size().z()) {
            cut_horizontal_local(model, 0, 0, new_height, Slic3r::ModelObjectCutAttribute::KeepUpper);
        }
    }

    if (params.nozzle_based_resize && std::abs(nozzle_scale - 1.0) > EPSILON)
        model.objects[0]->scale(nozzle_scale, nozzle_scale, nozzle_scale);

    model.objects[0]->ensure_on_bed();

    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); options_override.set_deserialize_strict("nozzle_temperature_initial_layer", std::to_string((int)start_temp));
    options_override.set_deserialize_strict("nozzle_temperature", std::to_string((int)start_temp));
    
    if (params.nozzle_based_resize)
    set_object_config(model.objects[0]->config, "layer_height", std::to_string(nozzle_diameter/2));
    set_object_config(model.objects[0]->config, "brim_type", "outer_only");
    set_object_config(model.objects[0]->config, "brim_width", std::to_string(5.0));
    set_object_config(model.objects[0]->config, "brim_object_gap", std::to_string(0.0));
    set_object_config(model.objects[0]->config, "alternate_extra_wall", (false) ? "1" : "0");
    set_object_config(model.objects[0]->config, "seam_slope_type", "none");
    set_object_config(model.objects[0]->config, "overhang_reverse", (false) ? "1" : "0");
    set_object_config(model.objects[0]->config, "precise_z_height", (false) ? "1" : "0");

    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");
    if (params.nozzle_based_resize)
        options_override.set_deserialize_strict("initial_layer_print_height", std::to_string(nozzle_diameter/2));
}

static void calib_max_vol_speed(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    if (params.mode != Slic3r::CalibMode::Calib_Vol_speed_Tower)
        return;
    if (!add_model_from_args(model, args, "SpeedTestStructure.drc"))
        return;

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);
    
    auto obj = model.objects[0];
    auto& obj_cfg = obj->config;

    auto bed_shape = current_config.option<Slic3r::ConfigOptionPoints>("printable_area")->values;
    Slic3r::BoundingBoxf bed_ext = Slic3r::get_extents(bed_shape);
    auto scale_obj = (bed_ext.size().x() - 10) / obj->bounding_box_exact().size().x();
    if (scale_obj < 1.0)
        obj->scale(scale_obj, 1, 1);

    const Slic3r::ConfigOptionFloats* nozzle_diameter_config = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter");
    double nozzle_diameter = nozzle_diameter_config->values[0];
    double line_width = nozzle_diameter * 1.75;
    double layer_height = nozzle_diameter * 0.8;

    auto max_lh = current_config.option<Slic3r::ConfigOptionFloats>("max_layer_height");
    auto new_max_lh = new Slic3r::ConfigOptionFloats(*max_lh);
    for (size_t i = 0; i < new_max_lh->values.size(); ++i) {
        if (new_max_lh->values[i] < layer_height)
            new_max_lh->values[i] = layer_height;
    }
    options_override.set_key_value("max_layer_height", new_max_lh);

    const double filament_max_volumetric_speed = current_config.option<Slic3r::ConfigOptionFloats>("filament_max_volumetric_speed")->get_at(0);
    options_override.set_deserialize_strict("filament_max_volumetric_speed", std::to_string(std::max(filament_max_volumetric_speed, 200.0)));
    options_override.set_deserialize_strict("slow_down_layer_time", std::to_string(0.0));
    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); set_object_config(obj_cfg, "enable_overhang_speed", (false) ? "1" : "0");
    set_object_config(obj_cfg, "wall_loops", std::to_string(1));
    set_object_config(obj_cfg, "alternate_extra_wall", (false) ? "1" : "0");
    set_object_config(obj_cfg, "top_shell_layers", std::to_string(0));
    set_object_config(obj_cfg, "bottom_shell_layers", std::to_string(0));
    set_object_config(obj_cfg, "sparse_infill_density", std::to_string(0.0) + "%");
    set_object_config(obj_cfg, "outer_wall_line_width", std::to_string(line_width));
    set_object_config(obj_cfg, "layer_height", std::to_string(layer_height));
    set_object_config(obj_cfg, "brim_type", "outer_and_inner");
    set_object_config(obj_cfg, "brim_width", std::to_string(5.0));
    set_object_config(obj_cfg, "brim_object_gap", std::to_string(0.0));
    set_object_config(obj_cfg, "precise_z_height", (false) ? "1" : "0");
    
    options_override.set_deserialize_strict("timelapse_type", "0");
    options_override.set_deserialize_strict("spiral_mode", (true) ? "1" : "0");
    options_override.set_deserialize_strict("max_volumetric_extrusion_rate_slope", std::to_string(0));
    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");

    auto obj_bb = obj->bounding_box_exact();
    auto height = (params.end - params.start + 1) / params.step;
    if (height < obj_bb.size().z()) {
        cut_horizontal_local(model, 0, 0, height, Slic3r::ModelObjectCutAttribute::KeepLower);
    }

    auto mm3_per_mm = Slic3r::Flow(line_width, layer_height, nozzle_diameter).mm3_per_mm() * current_config.option<Slic3r::ConfigOptionFloatsNullable>("filament_flow_ratio")->get_at(0);
    params.end   = params.end / mm3_per_mm;
    params.start = params.start / mm3_per_mm;
    params.step  = params.step / mm3_per_mm;
}


static void calib_retraction(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    if (params.mode != Slic3r::CalibMode::Calib_Retraction_tower)
        return;

    if (!add_model_from_args(model, args, "retraction_tower.drc"))
        return;

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);

    auto obj = model.objects[0];

    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");
    options_override.set_deserialize_strict("wipe_inward", (false) ? "1" : "0");

    float nozzle_diameter = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter")->get_at(0);
    float layer_height;
    if (nozzle_diameter <= 0.1f) {
        layer_height = 0.05f;
    } else if (nozzle_diameter <= 0.2f) {
        layer_height = 0.1f;
    } else {
        layer_height = 0.2f;
    }

    auto max_lh = current_config.option<Slic3r::ConfigOptionFloats>("max_layer_height");
    auto new_max_lh = new Slic3r::ConfigOptionFloats(*max_lh);
    for (size_t i = 0; i < new_max_lh->values.size(); ++i) {
        if (new_max_lh->values[i] < layer_height) new_max_lh->values[i] = layer_height;
    }
    options_override.set_key_value("max_layer_height", new_max_lh);

    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); options_override.set_deserialize_strict("use_firmware_retraction", (false) ? "1" : "0");
    
    set_object_config(obj->config, "wall_loops", std::to_string(2));
    set_object_config(obj->config, "top_shell_layers", std::to_string(0));
    set_object_config(obj->config, "bottom_shell_layers", std::to_string(3));
    set_object_config(obj->config, "sparse_infill_density", std::to_string(0) + "%");
    
    options_override.set_deserialize_strict("initial_layer_print_height", std::to_string(layer_height));
    set_object_config(obj->config, "layer_height", std::to_string(layer_height));
    set_object_config(obj->config, "alternate_extra_wall", (false) ? "1" : "0");
    set_object_config(obj->config, "seam_position", "aligned");
    set_object_config(obj->config, "wall_sequence", "inner wall/outer wall");
    set_object_config(obj->config, "overhang_reverse", (false) ? "1" : "0");
    set_object_config(obj->config, "precise_z_height", (false) ? "1" : "0");
    set_object_config(obj->config, "seam_slope_type", "none");

    auto obj_bb = obj->bounding_box_exact();
    auto height = 1.0 + 0.4 + ((params.end - params.start)) / params.step - EPSILON;
    if (height < obj_bb.size().z()) {
        cut_horizontal_local(model, 0, 0, height, Slic3r::ModelObjectCutAttribute::KeepLower);
    }
}

static void calib_VFA(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& params, const json& args) {
    if (params.mode != Slic3r::CalibMode::Calib_VFA_Tower)
        return;

    if (!add_model_from_args(model, args, "vfa.drc"))
        return;

    Slic3r::DynamicPrintConfig current_config = preset_bundle.full_config();
    current_config.apply(options_override, true);

    const Slic3r::ConfigOptionFloats* nozzle_diameter_config = current_config.option<Slic3r::ConfigOptionFloats>("nozzle_diameter");
    size_t nozzle_id = static_cast<size_t>(std::max(params.extruder_id, 0));
    double nozzle_diameter = 0.4; // vfa_base_nozzle_diameter
    if (nozzle_diameter_config && !nozzle_diameter_config->values.empty()) {
        nozzle_id = std::min(nozzle_id, nozzle_diameter_config->values.size() - 1);
        nozzle_diameter = nozzle_diameter_config->values[nozzle_id];
    }
    if (nozzle_diameter <= 0.0)
        nozzle_diameter = 0.4;

    double layer_height = params.vfa_layer_height > 0.0 ? params.vfa_layer_height : nozzle_diameter / 2.0;

    auto obj_bb = model.objects[0]->bounding_box_exact();
    auto height = 10.0 * ((params.end - params.start) / params.step + 1) - EPSILON; // vfa_base_block_height is 10.0
    if (height < obj_bb.size().z()) {
        cut_horizontal_local(model, 0, 0, height, Slic3r::ModelObjectCutAttribute::KeepLower);
    }

    if (params.nozzle_based_resize) {
        const double xy_scale = nozzle_diameter / 0.4;
        const double z_scale  = (50 * layer_height) / 10.0; // vfa_layers_per_block is 50
        if (std::abs(xy_scale - 1.0) > EPSILON || std::abs(z_scale - 1.0) > EPSILON)
            model.objects[0]->scale(xy_scale, xy_scale, z_scale);
    }

    model.objects[0]->ensure_on_bed();

    options_override.set_deserialize_strict("resonance_avoidance", (false) ? "1" : "0");
    zero_pressure_advance_where_disabled(options_override, preset_bundle); options_override.set_deserialize_strict("slow_down_layer_time", std::to_string( 0.0 ));
    options_override.set_deserialize_strict("enable_overhang_speed", (false) ? "1" : "0");
    options_override.set_deserialize_strict("timelapse_type", "0");
    options_override.set_deserialize_strict("wall_loops", std::to_string(1));
    options_override.set_deserialize_strict("alternate_extra_wall", (false) ? "1" : "0");
    options_override.set_deserialize_strict("top_shell_layers", std::to_string(0));
    options_override.set_deserialize_strict("bottom_shell_layers", std::to_string(1));
    options_override.set_key_value("sparse_infill_density", new Slic3r::ConfigOptionPercent(0));
    options_override.set_deserialize_strict("detect_thin_wall", (false) ? "1" : "0");
    options_override.set_deserialize_strict("spiral_mode", (true) ? "1" : "0");
    options_override.set_deserialize_strict("enable_wrapping_detection", (false) ? "1" : "0");
    options_override.set_deserialize_strict("precise_z_height", (false) ? "1" : "0");
    if (params.nozzle_based_resize) {
        options_override.set_deserialize_strict("initial_layer_print_height", std::to_string(layer_height));
    set_object_config(model.objects[0]->config, "layer_height", std::to_string(layer_height));
    }
    set_object_config(model.objects[0]->config, "brim_type", "outer_only");
    set_object_config(model.objects[0]->config, "brim_width", std::to_string(3.0));
    set_object_config(model.objects[0]->config, "brim_object_gap", std::to_string(0.0));

    params.vfa_layer_height = params.nozzle_based_resize ? layer_height : 0.0;
}


json setupCalibration(Slic3r::Model& model, Slic3r::DynamicPrintConfig& options_override, Slic3r::PresetBundle& preset_bundle, Slic3r::Calib_Params& calib_params, const json& args, const std::string& resources_dir) {
    // Desktop starts every calibration from new_project(): fresh params and an empty plate,
    // including any PA pattern G-code left by a previous calibration.
    calib_params = Slic3r::Calib_Params();
    model.plates_custom_gcodes.clear();
    model.calib_pa_pattern.reset();
    if (args.contains("print_numbers")) calib_params.print_numbers = args["print_numbers"].get<bool>();
    if (args.contains("mode")) {
        calib_params.mode = static_cast<Slic3r::CalibMode>(args["mode"].get<int>());
    }
    if (args.contains("start")) calib_params.start = args["start"].get<double>();
    if (args.contains("end")) calib_params.end = args["end"].get<double>();
    if (args.contains("step")) calib_params.step = args["step"].get<double>();
    if (args.contains("extruder_id")) calib_params.extruder_id = args["extruder_id"].get<int>();
    if (args.contains("nozzle_based_resize")) calib_params.nozzle_based_resize = args["nozzle_based_resize"].get<bool>();
    if (args.contains("vfa_layer_height")) calib_params.vfa_layer_height = args["vfa_layer_height"].get<double>();
    if (args.contains("speeds")) {
        calib_params.speeds.clear();
        for (auto& s : args["speeds"]) calib_params.speeds.push_back(s.get<double>());
    }
    if (args.contains("accelerations")) {
        calib_params.accelerations.clear();
        for (auto& a : args["accelerations"]) calib_params.accelerations.push_back(a.get<double>());
    }
    
    model.clear_objects();
    switch (calib_params.mode) {
        case Slic3r::CalibMode::Calib_PA_Line:
        case Slic3r::CalibMode::Calib_PA_Pattern:
        case Slic3r::CalibMode::Calib_PA_Tower:
            calib_pa(model, options_override, preset_bundle, calib_params, args);
            break;
        case Slic3r::CalibMode::Calib_Temp_Tower:
            calib_temp(model, options_override, preset_bundle, calib_params, args);
            break;
        case Slic3r::CalibMode::Calib_Retraction_tower:
            calib_retraction(model, options_override, preset_bundle, calib_params, args);
            break;
        case Slic3r::CalibMode::Calib_Vol_speed_Tower:
            calib_max_vol_speed(model, options_override, preset_bundle, calib_params, args);
            break;
        case Slic3r::CalibMode::Calib_VFA_Tower:
            calib_VFA(model, options_override, preset_bundle, calib_params, args);
            break;
        default:
            break;
    }

    json response;
    response["ok"] = true;
    return response;
}

} // namespace OrcaWasm
