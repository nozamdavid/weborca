#include "ConfigRules.hpp"
#include "libslic3r/libslic3r.h"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/MaterialType.hpp"
#include "libslic3r/GCode/AdaptivePAProcessor.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <vector>

namespace OrcaWeb {

using namespace Slic3r;

namespace {

// ConfigManipulation.cpp:1339
bool get_temperature_range(const DynamicPrintConfig &config, int &range_low, int &range_high, unsigned int variant_index)
{
    bool range_low_exist = false, range_high_exist = false;
    if (config.has("nozzle_temperature_range_low")) {
        range_low = config.opt_int("nozzle_temperature_range_low", variant_index);
        range_low_exist = true;
    }
    if (config.has("nozzle_temperature_range_high")) {
        range_high = config.opt_int("nozzle_temperature_range_high", variant_index);
        range_high_exist = true;
    }
    return range_low_exist && range_high_exist;
}

// ConfigManipulation.cpp:280
void layer_height_limits(const DynamicPrintConfig& config, const RuleContext& context, double& min_layer_height, double& max_layer_height)
{
    if (context.min_layer_height > 0.0 && context.max_layer_height > 0.0) {
        min_layer_height = context.min_layer_height;
        max_layer_height = context.max_layer_height;
        return;
    }
    if (config.has("min_layer_height") && config.has("max_layer_height")) {
        const auto* min_opt = config.option<ConfigOptionFloats>("min_layer_height");
        const auto* max_opt = config.option<ConfigOptionFloats>("max_layer_height");
        if (min_opt && !min_opt->values.empty() && max_opt && !max_opt->values.empty()) {
            min_layer_height = *std::min_element(min_opt->values.begin(), min_opt->values.end());
            max_layer_height = *std::max_element(max_opt->values.begin(), max_opt->values.end());
            return;
        }
    }
    min_layer_height = context.min_layer_height;
    max_layer_height = context.max_layer_height;
}

} // namespace

// ConfigManipulation.cpp:91
void check_nozzle_recommended_temperature_range(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    unsigned int variant_index = context.variant_index >= 0 ? (unsigned int)context.variant_index : 0;
    int temperature_range_low = 0, temperature_range_high = 0;
    // ConfigManipulation.cpp:95
    if (!get_temperature_range(config, temperature_range_low, temperature_range_high, variant_index))
        return;

    // ConfigManipulation.cpp:98
    // Get the selected filament type
    std::string filament_type = "";
    if (config.has("filament_type") && config.option<ConfigOptionStrings>("filament_type")->values.size() > 0) {
        filament_type = config.option<ConfigOptionStrings>("filament_type")->values[0];
    }

    int min_recommended_temp = 190;
    int max_recommended_temp = 300;

    // ConfigManipulation.cpp:108
    if (!MaterialType::get_temperature_range(filament_type, min_recommended_temp, max_recommended_temp)) {
        filament_type = "Unknown";
    }

    // ConfigManipulation.cpp:112
    std::string msg_text;
    bool need_check = false;
    if (temperature_range_low < min_recommended_temp) {
        msg_text += "A minimum temperature above " + std::to_string(min_recommended_temp) + "℃ is recommended for " + filament_type + ".\n";
        need_check = true;
    }
    if (temperature_range_high > max_recommended_temp) {
        msg_text += "A maximum temperature below " + std::to_string(max_recommended_temp) + "℃ is recommended for " + filament_type + ".\n";
        need_check = true;
    }
    if (temperature_range_low > temperature_range_high) {
        msg_text += "The recommended minimum temperature cannot be higher than the recommended maximum temperature.\n";
        need_check = true;
    }
    if (need_check) {
        msg_text += "Please check.\n";
        result.messages.push_back(msg_text);
    }
}

// ConfigManipulation.cpp:133
void check_nozzle_temperature_range(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    unsigned int variant_index = context.variant_index >= 0 ? (unsigned int)context.variant_index : 0;
    int temperature_range_low = 0, temperature_range_high = 0;
    // ConfigManipulation.cpp:141
    if (!get_temperature_range(config, temperature_range_low, temperature_range_high, variant_index))
        return;

    // ConfigManipulation.cpp:143
    if (config.has("nozzle_temperature")) {
        if (config.opt_int("nozzle_temperature", variant_index) < temperature_range_low ||
            config.opt_int("nozzle_temperature", variant_index) > temperature_range_high) {
            std::string msg_text = "The nozzle may become clogged when the temperature is out of the recommended range.\nPlease make sure whether to use this temperature to print.\n\n";
            msg_text += "The recommended nozzle temperature for this filament type is [" +
                        std::to_string(temperature_range_low) + ", " +
                        std::to_string(temperature_range_high) + "] degrees Celsius.";
            result.messages.push_back(msg_text);
        }
    }
}

// ConfigManipulation.cpp:151
void check_nozzle_temperature_initial_layer_range(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    unsigned int variant_index = context.variant_index >= 0 ? (unsigned int)context.variant_index : 0;
    int temperature_range_low = 0, temperature_range_high = 0;
    // ConfigManipulation.cpp:161
    if (!get_temperature_range(config, temperature_range_low, temperature_range_high, variant_index))
        return;

    // ConfigManipulation.cpp:163
    if (config.has("nozzle_temperature_initial_layer")) {
        if (config.opt_int("nozzle_temperature_initial_layer", variant_index) < temperature_range_low ||
            config.opt_int("nozzle_temperature_initial_layer", variant_index) > temperature_range_high) {
            std::string msg_text = "The nozzle may become clogged when the temperature is out of the recommended range.\nPlease make sure whether to use this temperature to print.\n\n";
            msg_text += "The recommended nozzle temperature for this filament type is [" +
                        std::to_string(temperature_range_low) + ", " +
                        std::to_string(temperature_range_high) + "] degrees Celsius.";
            result.messages.push_back(msg_text);
        }
    }
}

// ConfigManipulation.cpp:172
void check_adaptive_pressure_advance_model(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    // ConfigManipulation.cpp:174
    if (!config.has("adaptive_pressure_advance_model"))
        return;

    const auto* model = config.option<ConfigOptionStrings>("adaptive_pressure_advance_model");
    if (model == nullptr)
        return;

    // ConfigManipulation.cpp:184
    // Each extruder variant holds its own model.
    std::string error;
    for (const std::string& variant_model : model->values) {
        error = AdaptivePAProcessor::validate_adaptive_pa_model(variant_model);
        if (!error.empty())
            break;
    }
    // ConfigManipulation.cpp:192
    if (!error.empty()) {
        std::string msg_text = "Adaptive Pressure Advance model validation failed:\n" + error;
        result.messages.push_back(msg_text);
    }
}

// ConfigManipulation.cpp:203
void check_filament_max_volumetric_speed(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    // ConfigManipulation.cpp:208
    float max_volumetric_speed = config.has("filament_max_volumetric_speed") ? config.opt_float("filament_max_volumetric_speed", (float)0.5) : 0.5f;
    // ConfigManipulation.cpp:210
    // BBS: limite the min max_volumetric_speed
    if (max_volumetric_speed < 0.5f) {
        result.fixes.push_back({
            "filament_max_volumetric_speed",
            "0.5",
            "Too small max volumetric speed.\nValue was reset to 0.5"
        });
    }
}

// ConfigManipulation.cpp:221
void check_filament_ironing_spacing(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    // ConfigManipulation.cpp:223
    const auto* opt = config.option<ConfigOptionFloatsNullable>("filament_ironing_spacing");
    if (opt == nullptr)
        return;
    std::vector<double> values = opt->values;
    bool reset = false;
    // ConfigManipulation.cpp:229
    for (size_t i = 0; i < values.size(); ++i) {
        if (!opt->is_nil(i) && values[i] < IRONING_SPACING_MIN) {
            values[i] = 0.1;
            reset = true;
        }
    }
    // ConfigManipulation.cpp:235
    if (!reset)
        return;

    ConfigOptionFloatsNullable fixed_opt(values);
    for (size_t i = 0; i < values.size(); ++i) {
        if (opt->is_nil(i))
            fixed_opt.set_at_to_nil(i);
    }
    result.fixes.push_back({
        "filament_ironing_spacing",
        fixed_opt.serialize(),
        "Ironing spacing too small\nIt has been reset to 0.1"
    });
}

// ConfigManipulation.cpp:242
void check_chamber_temperature(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    // ConfigManipulation.cpp:244
    bool support_chamber_temp_control = context.support_chamber_temp_control ||
        (config.has("support_chamber_temp_control") && config.opt_bool("support_chamber_temp_control"));

    // ConfigManipulation.cpp:245
    if (support_chamber_temp_control && config.has("chamber_temperature")) {
        std::string filament_type = "";
        if (config.has("filament_type") && config.option<ConfigOptionStrings>("filament_type")->values.size() > 0)
            filament_type = config.option<ConfigOptionStrings>("filament_type")->get_at(0);
        int chamber_min_temp = 0, chamber_max_temp = 0;
        // ConfigManipulation.cpp:249
        if (MaterialType::get_chamber_temperature_range(filament_type, chamber_min_temp, chamber_max_temp)) {
            if (config.has("chamber_temperature") && chamber_max_temp < config.option<ConfigOptionInts>("chamber_temperature")->get_at(0)) {
                std::string msg_text = "Current chamber temperature is higher than the material's safe temperature; this may result in material softening and nozzle clogs. The maximum safe temperature for the material is " + std::to_string(chamber_max_temp);
                result.messages.push_back(msg_text);
            }
        }
    }
}

// ConfigManipulation.cpp:258
void check_chamber_minimal_temperature(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    // ConfigManipulation.cpp:262
    if (config.has("chamber_minimal_temperature") && config.has("chamber_temperature")) {
        const int chamber_min_temp    = config.option<ConfigOptionInts>("chamber_minimal_temperature")->get_at(0);
        const int chamber_target_temp = config.option<ConfigOptionInts>("chamber_temperature")->get_at(0);
        // ConfigManipulation.cpp:265
        if (chamber_min_temp > chamber_target_temp) {
            std::string msg_text = "The minimal chamber temperature (" + std::to_string(chamber_min_temp) + "℃) is higher than the target chamber temperature (" + std::to_string(chamber_target_temp) + "℃). The minimal value is the threshold at which printing starts while the chamber keeps heating toward the target, so it should not exceed it. It will be clamped to the target.";
            result.fixes.push_back({
                "chamber_minimal_temperature",
                std::to_string(chamber_target_temp),
                msg_text
            });
        }
    }
}

// ConfigManipulation.cpp:289
void check_layer_height(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    double min_layer_height = 0., max_layer_height = 0.;
    layer_height_limits(config, context, min_layer_height, max_layer_height);
    if (!config.has("layer_height"))
        return;
    const double layer_height = config.opt_float("layer_height");

    // ConfigManipulation.cpp:295
    if (min_layer_height > EPSILON && layer_height < EPSILON) {
        result.fixes.push_back({
            "layer_height",
            std::to_string(min_layer_height),
            "Layer height is too small. It will be set to the minimum (" + std::to_string(min_layer_height) + " mm)."
        });
        return;
    }
    // ConfigManipulation.cpp:308
    if (max_layer_height > EPSILON && layer_height > max_layer_height + EPSILON) {
        // ConfigManipulation.cpp:313 layer_height_out_of_range_dialog(config, max_layer_height)
        result.fixes.push_back({
            "layer_height",
            std::to_string(max_layer_height),
            "Layer height is outside the limits set in Printer Settings -> Extruder -> Layer height limits, this may cause printing quality issues. Adjust it to the limit (" + std::to_string(max_layer_height) + " mm) automatically? [Yes: Adjust]"
        });
        return;
    }
    // ConfigManipulation.cpp:310
    if (min_layer_height > EPSILON && layer_height < min_layer_height - EPSILON) {
        // ConfigManipulation.cpp:313 layer_height_out_of_range_dialog(config, min_layer_height)
        result.fixes.push_back({
            "layer_height",
            std::to_string(min_layer_height),
            "Layer height is outside the limits set in Printer Settings -> Extruder -> Layer height limits, this may cause printing quality issues. Adjust it to the limit (" + std::to_string(min_layer_height) + " mm) automatically? [Yes: Adjust]"
        });
        return;
    }
}

// ConfigManipulation.cpp:332
void update_print_fff_config(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    // ConfigManipulation.cpp:343
    bool is_object_config = (!context.is_global_config && !context.is_plate_config);

    // ConfigManipulation.cpp:345
    // layer_height shouldn't be equal to zero
    if (config.has("layer_height")) {
        auto layer_height = config.opt_float("layer_height");
        if (layer_height < EPSILON) {
            result.fixes.push_back({
                "layer_height",
                "0.2",
                "Layer height too small\nIt has been reset to 0.2"
            });
        }
    }

    // ConfigManipulation.cpp:358
    // BBS: ironing_spacing shouldn't be too small or equal to zero
    if (config.has("ironing_spacing") && config.opt_float("ironing_spacing") < IRONING_SPACING_MIN) {
        result.fixes.push_back({
            "ironing_spacing",
            "0.1",
            "Ironing spacing too small\nIt has been reset to 0.1"
        });
    }

    // ConfigManipulation.cpp:370
    if (config.has("support_ironing_spacing") && config.opt_float("support_ironing_spacing") < IRONING_SPACING_MIN) {
        result.fixes.push_back({
            "support_ironing_spacing",
            "0.1",
            "Ironing spacing too small\nIt has been reset to 0.1"
        });
    }

    // ConfigManipulation.cpp:382
    if (config.has("initial_layer_print_height") && config.option<ConfigOptionFloat>("initial_layer_print_height")->value < EPSILON) {
        result.fixes.push_back({
            "initial_layer_print_height",
            "0.2",
            "Zero initial layer height is invalid.\n\nThe first layer height will be reset to 0.2."
        });
    }

    // ConfigManipulation.cpp:395
    if (config.has("xy_hole_compensation") && std::abs(config.option<ConfigOptionFloat>("xy_hole_compensation")->value) > 2) {
        result.fixes.push_back({
            "xy_hole_compensation",
            "0",
            "This setting is only used for tuning model size by small amounts.\nFor example, when the model size has small errors or when tolerances are incorrect. For large adjustments, please use the model scale function.\n\nThe value will be reset to 0."
        });
    }

    // ConfigManipulation.cpp:407
    if (config.has("xy_contour_compensation") && std::abs(config.option<ConfigOptionFloat>("xy_contour_compensation")->value) > 2) {
        result.fixes.push_back({
            "xy_contour_compensation",
            "0",
            "This setting is only used for tuning model size by small amounts.\nFor example, when the model size has small errors or when tolerances are incorrect. For large adjustments, please use the model scale function.\n\nThe value will be reset to 0."
        });
    }

    // ConfigManipulation.cpp:419
    if (config.has("elefant_foot_compensation") && config.option<ConfigOptionFloat>("elefant_foot_compensation")->value > 1) {
        result.fixes.push_back({
            "elefant_foot_compensation",
            "0",
            "The elephant foot compensation value is too large.\nIf there are significant elephant foot issues, please check other settings.\nThe bed temperature may be too high, for example.\n\nThe value will be reset to 0."
        });
    }

    // ConfigManipulation.cpp:431
    if (config.has("enable_wrapping_detection") && config.option<ConfigOptionBool>("enable_wrapping_detection")->value) {
        if (!context.support_wrapping_detection) {
            result.fixes.push_back({
                "enable_wrapping_detection",
                "0",
                "Printer does not support wrapping detection"
            });
        }
    }

    // ConfigManipulation.cpp:446
    double sparse_infill_density = config.has("sparse_infill_density") ? config.option<ConfigOptionPercent>("sparse_infill_density")->value : 0.0;
    auto timelapse_type = config.has("timelapse_type") ? config.opt_enum<TimelapseType>("timelapse_type") : TimelapseType::tlTraditional;

    if (!context.is_plate_config &&
        config.has("spiral_mode") && config.opt_bool("spiral_mode") &&
        ! (config.has("wall_loops") && config.opt_int("wall_loops") == 1 &&
           config.has("top_shell_layers") && config.opt_int("top_shell_layers") == 0 &&
           sparse_infill_density == 0 &&
           config.has("enable_support") && !config.opt_bool("enable_support") &&
           config.has("enforce_support_layers") && config.opt_int("enforce_support_layers") == 0 &&
           config.has("detect_thin_wall") && !config.opt_bool("detect_thin_wall") &&
           config.has("overhang_reverse") && !config.opt_bool("overhang_reverse") &&
           timelapse_type == TimelapseType::tlTraditional &&
           config.has("enable_wrapping_detection") && !config.opt_bool("enable_wrapping_detection")))
    {
        // ConfigManipulation.cpp:461 show_spiral_mode_settings_dialog
        std::string spiral_reason_prefix = "Spiral mode only works when wall loops is 1, support is disabled, clumping detection by probing is disabled, top shell layers is 0, sparse infill density is 0 and timelapse type is traditional.";
        std::string spiral_yes_reason = spiral_reason_prefix + " [Yes: Change these settings and enable spiral/vase mode automatically]";
        std::string spiral_no_reason = spiral_reason_prefix + " [No: Cancel enabling spiral mode]";

        // Option: Yes
        result.fixes.push_back({"wall_loops", "1", spiral_yes_reason});
        result.fixes.push_back({"top_shell_layers", "0", spiral_yes_reason});
        result.fixes.push_back({"sparse_infill_density", "0%", spiral_yes_reason});
        result.fixes.push_back({"enable_support", "0", spiral_yes_reason});
        result.fixes.push_back({"enforce_support_layers", "0", spiral_yes_reason});
        result.fixes.push_back({"detect_thin_wall", "0", spiral_yes_reason});
        result.fixes.push_back({"overhang_reverse", "0", spiral_yes_reason});
        result.fixes.push_back({"timelapse_type", "traditional", spiral_yes_reason});
        result.fixes.push_back({"enable_wrapping_detection", "0", spiral_yes_reason});

        // Option: No (only available when !is_object_config)
        if (!is_object_config) {
            result.fixes.push_back({"spiral_mode", "0", spiral_no_reason});
        }
    }

    // ConfigManipulation.cpp:488
    if (config.has("alternate_extra_wall") && config.opt_bool("alternate_extra_wall") &&
        config.has("ensure_vertical_shell_thickness") &&
        (config.opt_enum<EnsureVerticalShellThickness>("ensure_vertical_shell_thickness") == evstAll)) {
        std::string alt_wall_yes_reason = "Alternate extra wall doesn't work well when ensure vertical shell thickness is set to All. [Yes - Change ensure vertical shell thickness to Moderate and enable alternate extra wall]";
        std::string alt_wall_no_reason = "Alternate extra wall doesn't work well when ensure vertical shell thickness is set to All. [No - Don't use alternate extra wall]";

        if (!context.is_global_config) {
            result.fixes.push_back({"ensure_vertical_shell_thickness", "Moderate", alt_wall_yes_reason});
            result.fixes.push_back({"alternate_extra_wall", "1", alt_wall_yes_reason});
        } else {
            result.fixes.push_back({"ensure_vertical_shell_thickness", "Moderate", alt_wall_yes_reason});
            result.fixes.push_back({"alternate_extra_wall", "1", alt_wall_yes_reason});
            result.fixes.push_back({"ensure_vertical_shell_thickness", "All", alt_wall_no_reason});
            result.fixes.push_back({"alternate_extra_wall", "0", alt_wall_no_reason});
        }
    }

    // ConfigManipulation.cpp:515
    int filament_cnt = context.filament_cnt;
    if (filament_cnt <= 0 && config.has("filament_type")) {
        filament_cnt = config.option<ConfigOptionStrings>("filament_type")->values.size();
    }
    if (filament_cnt <= 0) filament_cnt = 1;

    // ConfigManipulation.cpp:575
    // BBL printers do not support cone wipe tower
    if (config.has("enable_prime_tower") && config.opt_bool("enable_prime_tower") && context.is_bbl_printer) {
        if (config.has("wipe_tower_wall_type")) {
            auto wipe_tower_wall_type = config.opt_enum<WipeTowerWallType>("wipe_tower_wall_type");
            if (wipe_tower_wall_type == WipeTowerWallType::wtwCone) {
                result.fixes.push_back({
                    "wipe_tower_wall_type",
                    "rectangle",
                    "BBL printers do not support cone wipe tower"
                });
            }
        }
    }

    // ConfigManipulation.cpp:585
    // Check "enable_support" and "overhangs" relations only on global settings level
    if (context.is_global_config && config.has("enable_support") && config.opt_bool("enable_support")) {
        if (config.has("detect_overhang_wall") && !config.opt_bool("detect_overhang_wall")) {
            result.fixes.push_back({
                "detect_overhang_wall",
                "1",
                "Enable detect overhang wall when support is enabled"
            });
        }
    }

    // ConfigManipulation.cpp:600
    if (config.has("enable_support") && config.opt_bool("enable_support") &&
        config.has("support_type") && config.has("support_style")) {
        auto support_type = config.opt_enum<SupportType>("support_type");
        auto support_style = config.opt_enum<SupportMaterialStyle>("support_style");
        std::set<int> enum_set_normal = { smsDefault, smsGrid, smsSnug };
        std::set<int> enum_set_tree   = { smsDefault, smsTreeSlim, smsTreeStrong, smsTreeHybrid, smsTreeOrganic };
        const auto& set = is_tree(support_type) ? enum_set_tree : enum_set_normal;
        if (set.find(support_style) == set.end()) {
            result.fixes.push_back({
                "support_style",
                "default",
                "Support style is not supported for current support type; reset to default"
            });
        }
    }

    // ConfigManipulation.cpp:618
    // Reset filament overrides pointing at a slot that no longer exists.
    static const char* physical_only_keys[] = { "support_filament", "support_interface_filament", "wipe_tower_filament" };
    static const char* feature_keys[] = { "outer_wall_filament_id", "inner_wall_filament_id",
                                          "sparse_infill_filament_id", "internal_solid_filament_id",
                                          "top_surface_filament_id", "bottom_surface_filament_id" };
    auto check_invalid_filament = [&](const char* key, bool allow_mixed) {
        if (!config.has(key)) return;
        const auto* opt = dynamic_cast<const ConfigOptionInt*>(config.option(key));
        if (opt == nullptr) return;
        const int val = opt->getInt();
        const bool out_of_range = val > filament_cnt;
        bool is_mixed = false;
        if (!allow_mixed && val > 0 && val <= filament_cnt) {
            int slot = val - 1;
            if (slot >= 0 && slot < (int)context.is_mixed_filament.size())
                is_mixed = context.is_mixed_filament[slot];
        }
        if (!out_of_range && !is_mixed) return;
        result.fixes.push_back({
            key,
            "0",
            out_of_range ? "Filament index out of range (" + std::to_string(val) + " > " + std::to_string(filament_cnt) + ")"
                         : "Mixed filament not supported for " + std::string(key)
        });
    };
    for (const char* key : physical_only_keys)
        check_invalid_filament(key, false);
    for (const char* key : feature_keys)
        check_invalid_filament(key, true);

    // ConfigManipulation.cpp:648
    // Sub-layer splitting divides each layer by the mix ratio; an adaptive layer profile makes
    // those sub-layer heights vary per layer, which degrades the blend. Warn once per enable.
    if (config.has("enable_mixed_color_sublayer") && config.opt_bool("enable_mixed_color_sublayer")) {
        if (context.has_variable_layer_height && !context.no_warn_mixed_sublayer_variable_layer) {
            result.messages.push_back("Using variable layer height together with mixed color sublayer may result in poor color mixing quality.");
        }
    }

    // ConfigManipulation.cpp:679
    double current_layer_height = config.has("layer_height") ? config.opt_float("layer_height") : 0.2;
    if (config.has("seam_slope_type") && config.opt_enum<SeamScarfType>("seam_slope_type") != SeamScarfType::None &&
        config.has("seam_slope_start_height") &&
        config.get_abs_value("seam_slope_start_height") >= current_layer_height) {
        result.fixes.push_back({
            "seam_slope_start_height",
            "0",
            "seam_slope_start_height needs to be smaller than layer_height.\nReset to 0."
        });
    }

    // ConfigManipulation.cpp:690
    if (config.has("skin_infill_depth") && config.has("infill_lock_depth")) {
        float skin_depth = config.opt_float("skin_infill_depth");
        if (config.opt_float("infill_lock_depth") > skin_depth) {
            result.fixes.push_back({
                "infill_lock_depth",
                std::to_string(skin_depth / 2.0f),
                "Lock depth should be smaller than skin depth.\nReset to 50% of skin depth."
            });
        }
    }

    // ConfigManipulation.cpp:702
    bool have_arachne = config.has("wall_generator") && (config.opt_enum<PerimeterGeneratorType>("wall_generator") == PerimeterGeneratorType::Arachne);
    if (config.has("fuzzy_skin_mode") && config.opt_enum<FuzzySkinMode>("fuzzy_skin_mode") != FuzzySkinMode::Displacement && !have_arachne) {
        std::string fz_msg = "Both [Extrusion] and [Combined] modes of Fuzzy Skin require the Arachne Wall Generator to be enabled.";
        std::string fz_yes = fz_msg + " [Yes - Enable Arachne Wall Generator]";
        std::string fz_no  = fz_msg + " [No  - Disable Arachne Wall Generator and set [Displacement] mode of the Fuzzy Skin]";
        result.fixes.push_back({"wall_generator", "arachne", fz_yes});
        result.fixes.push_back({"fuzzy_skin_mode", "displacement", fz_no});
    }
}

// ConfigManipulation.cpp:748
void toggle_print_fff_options(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    auto toggle_field = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].enabled = toggle;
    };
    auto toggle_line = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].visible = toggle;
    };
    auto set_option_label = [&](const std::string& opt_key, const std::string& label, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].label = label;
    };

    // ConfigManipulation.cpp:750
    GCodeFlavor gcflavor = config.has("gcode_flavor") ? config.opt_enum<GCodeFlavor>("gcode_flavor") : GCodeFlavor::gcfMarlinFirmware;

    // ConfigManipulation.cpp:755
    const bool gcf_is_marlin_firmware = gcflavor == GCodeFlavor::gcfMarlinFirmware;
    const bool gcf_is_klipper = gcflavor == GCodeFlavor::gcfKlipper;

    int variant_index = context.variant_index >= 0 ? context.variant_index : 0;
    bool is_global_config = context.is_global_config;
    bool is_BBL_Printer = context.is_bbl_printer;

    // ConfigManipulation.cpp:758
    bool have_volumetric_extrusion_rate_slope = config.has("max_volumetric_extrusion_rate_slope") && config.option<ConfigOptionFloat>("max_volumetric_extrusion_rate_slope")->value > 0;
    float have_volumetric_extrusion_rate_slope_segment_length = config.has("max_volumetric_extrusion_rate_slope_segment_length") ? config.option<ConfigOptionFloat>("max_volumetric_extrusion_rate_slope_segment_length")->value : 0.0f;
    toggle_field("enable_arc_fitting", !have_volumetric_extrusion_rate_slope);
    toggle_line("max_volumetric_extrusion_rate_slope_segment_length", have_volumetric_extrusion_rate_slope);
    toggle_line("extrusion_rate_smoothing_external_perimeter_only", have_volumetric_extrusion_rate_slope);
    if (have_volumetric_extrusion_rate_slope) {
        result.fixes.push_back({"enable_arc_fitting", "0", "Arc fitting disabled when volumetric extrusion rate slope is active"});
    }
    if (have_volumetric_extrusion_rate_slope_segment_length < 0.5f) {
        result.fixes.push_back({"max_volumetric_extrusion_rate_slope_segment_length", "1", "Extrusion rate slope segment length reset to 1"});
    }

    // ConfigManipulation.cpp:771
    bool have_perimeters = config.has("wall_loops") && config.opt_int("wall_loops") > 0;
    for (auto el : { "extra_perimeters_on_overhangs", "ensure_vertical_shell_thickness", "detect_thin_wall", "detect_overhang_wall",
        "seam_position", "staggered_inner_seams", "wall_sequence", "outer_wall_line_width" })
        toggle_field(el, have_perimeters);
    for (auto el : { "inner_wall_speed", "outer_wall_speed", "small_perimeter_speed", "small_perimeter_threshold" })
        toggle_field(el, have_perimeters, variant_index);

    // ConfigManipulation.cpp:780
    bool have_infill = config.has("sparse_infill_density") && config.option<ConfigOptionPercent>("sparse_infill_density")->value > 0;
    for (auto el : { "sparse_infill_pattern", "infill_combination", "fill_multiline","infill_direction",
                     "infill_complete_top",
        "minimum_sparse_infill_area", "sparse_infill_filament_id","infill_shift_step","sparse_infill_rotate_template","symmetric_infill_y_axis"})
        toggle_line(el, have_infill);

    // ConfigManipulation.cpp:788
    InfillPattern pattern = config.has("sparse_infill_pattern") ? config.opt_enum<InfillPattern>("sparse_infill_pattern") : InfillPattern::ipGrid;

    // ConfigManipulation.cpp:791
    bool have_infill_anchor = have_infill && pattern != ipConcentric && pattern != ipSpiralInset;
    toggle_line("infill_anchor", have_infill_anchor);
    toggle_line("infill_anchor_max", have_infill_anchor);

    // ConfigManipulation.cpp:795
    bool have_combined_infill = config.has("infill_combination") && config.opt_bool("infill_combination") && have_infill;
    toggle_line("infill_combination_max_layer_height", have_combined_infill);

    // ConfigManipulation.cpp:799
    bool have_multiline_infill_pattern = pattern == ipGyroid || pattern == ipGrid || pattern == ipRectilinear || pattern == ipTpmsD || pattern == ipTpmsFK || pattern == ipCrossHatch || pattern == ipHoneycomb || pattern == ipLateralLattice || pattern == ipLateralHoneycomb || pattern == ipConcentric ||
                                         pattern == ipCubic || pattern == ipStars || pattern == ipAlignedRectilinear || pattern == ipLightning || pattern == ip3DHoneycomb || pattern == ipAdaptiveCubic || pattern == ipSupportCubic|| pattern == ipTriangles || pattern == ipQuarterCubic|| pattern == ipArchimedeanChords || pattern == ipHilbertCurve || pattern == ipOctagramSpiral;

    // ConfigManipulation.cpp:804
    toggle_line("gyroid_optimized", have_infill && pattern == ipGyroid);

    // ConfigManipulation.cpp:807
    if (have_infill) {
        toggle_field("fill_multiline", have_multiline_infill_pattern);
        if (!have_multiline_infill_pattern) {
            result.fixes.push_back({"fill_multiline", "1", "Infill pattern does not support multiline; reset to 1"});
        }
        bool infill_anchor = pattern != ipLine;
        toggle_field("infill_anchor_max", infill_anchor);

        bool has_infill_anchors = infill_anchor && config.has("infill_anchor_max") && config.option<ConfigOptionFloatOrPercent>("infill_anchor_max")->value > 0;
        toggle_field("infill_anchor", has_infill_anchors);
    }

    // ConfigManipulation.cpp:823
    bool is_cross_zag = pattern == InfillPattern::ipCrossZag;
    bool is_locked_zig = pattern == InfillPattern::ipLockedZag;

    toggle_line("infill_shift_step", is_cross_zag || is_locked_zig);

    for (auto el : { "skeleton_infill_density", "skin_infill_density", "infill_lock_depth", "skin_infill_depth","skin_infill_line_width", "skeleton_infill_line_width" })
        toggle_line(el, is_locked_zig);

    bool is_zig_zag = pattern == InfillPattern::ipZigZag;

    toggle_line("symmetric_infill_y_axis", is_zig_zag || is_cross_zag || is_locked_zig);

    bool is_3Dhoneycomb = pattern == InfillPattern::ip3DHoneycomb;
    toggle_line("infill_complete_top", have_infill && is_3Dhoneycomb);

    // ConfigManipulation.cpp:838
    bool has_spiral_vase = config.has("spiral_mode") && config.opt_bool("spiral_mode");
    toggle_line("spiral_mode_smooth", has_spiral_vase);
    toggle_line("spiral_mode_max_xy_smoothing", has_spiral_vase && config.has("spiral_mode_smooth") && config.opt_bool("spiral_mode_smooth"));
    toggle_line("spiral_starting_flow_ratio", has_spiral_vase);
    toggle_line("spiral_finishing_flow_ratio", has_spiral_vase);
    bool has_top_shell_layers = (config.has("top_shell_layers") && config.opt_int("top_shell_layers") > 0) || (has_spiral_vase && config.has("bottom_shell_layers") && config.opt_int("bottom_shell_layers") > 1);
    bool has_top_shell = has_top_shell_layers && config.has("top_surface_density") && config.option<ConfigOptionPercent>("top_surface_density")->value > 0;
    bool has_bottom_shell = config.has("bottom_shell_layers") && config.opt_int("bottom_shell_layers") > 0;
    bool has_solid_infill = has_top_shell_layers || has_bottom_shell;
    int fill_multiline_val = config.has("fill_multiline") ? config.opt_int("fill_multiline") : 1;
    toggle_line("sparse_infill_smooth_factor", have_infill && is_smoothable_infill_pattern(pattern, fill_multiline_val));
    toggle_field("top_surface_pattern", has_top_shell);
    toggle_field("bottom_surface_pattern", has_bottom_shell);
    toggle_field("top_surface_density", has_top_shell_layers);
    toggle_field("bottom_surface_density", has_bottom_shell);
    toggle_field("top_layer_direction", has_top_shell);
    toggle_field("bottom_layer_direction", has_bottom_shell);

    // ConfigManipulation.cpp:855
    toggle_line("top_surface_expansion", has_top_shell);
    toggle_line("top_surface_expansion_margin", has_top_shell);
    bool has_top_surface_expansion = config.has("top_surface_expansion") && config.opt_float("top_surface_expansion") > 0;
    toggle_field("top_surface_expansion_margin", has_top_surface_expansion);
    toggle_line("top_surface_expansion_direction", has_top_shell);
    toggle_field("top_surface_expansion_direction", has_top_surface_expansion);

    // ConfigManipulation.cpp:863
    auto is_centered_pattern = [](InfillPattern p) {
        return p == InfillPattern::ipArchimedeanChords || p == InfillPattern::ipOctagramSpiral;
    };
    bool is_top_centered = config.has("top_surface_pattern") && is_centered_pattern(config.option<ConfigOptionEnum<InfillPattern>>("top_surface_pattern")->value);
    bool is_bottom_centered = config.has("bottom_surface_pattern") && is_centered_pattern(config.option<ConfigOptionEnum<InfillPattern>>("bottom_surface_pattern")->value);
    bool has_centered_surface = (has_top_shell && is_top_centered) || (has_bottom_shell && is_bottom_centered);

    toggle_line("center_of_surface_pattern", has_centered_surface);

    // ConfigManipulation.cpp:874
    bool is_internal_infill_separable = is_separable_infill_pattern(pattern) ||
                                        (config.has("sparse_infill_rotate_template") && config.opt_string("sparse_infill_rotate_template") != "") ||
                                        (config.has("solid_infill_rotate_template") && config.opt_string("solid_infill_rotate_template") != "");
    toggle_line("separated_infills", is_internal_infill_separable);

    // ConfigManipulation.cpp:880
    auto is_centered_fill = [](InfillPattern p) { return p == ipConcentric || p == ipSpiralInset || p == ipArchimedeanChords || p == ipOctagramSpiral; };
    toggle_line("top_surface_fill_order", has_top_shell && config.has("top_surface_pattern") && is_centered_fill(config.opt_enum<InfillPattern>("top_surface_pattern")));
    toggle_line("bottom_surface_fill_order", has_bottom_shell && config.has("bottom_surface_pattern") && is_centered_fill(config.opt_enum<InfillPattern>("bottom_surface_pattern")));

    // ConfigManipulation.cpp:885
    for (auto el : { "infill_direction", "sparse_infill_line_width", "gap_fill_target","filter_out_gap_fill","infill_wall_overlap",
        "bridge_angle", "internal_bridge_angle", "relative_bridge_angle",
        "solid_infill_direction", "solid_infill_rotate_template", "internal_solid_infill_pattern", "internal_solid_filament_id", "top_surface_filament_id", "bottom_surface_filament_id",
        })
        toggle_field(el, have_infill || has_solid_infill);
    for (auto el : { "sparse_infill_speed", "bridge_speed", "internal_bridge_speed"})
        toggle_field(el, have_infill || has_solid_infill, variant_index);

    // ConfigManipulation.cpp:893
    toggle_field("top_shell_thickness", ! has_spiral_vase && has_top_shell_layers);
    toggle_field("bottom_shell_thickness", ! has_spiral_vase && has_bottom_shell);

    // ConfigManipulation.cpp:897
    toggle_field("gap_infill_speed", have_perimeters, variant_index);

    toggle_field("top_surface_line_width", has_top_shell);
    toggle_field("top_surface_speed", has_top_shell, variant_index);

    // ConfigManipulation.cpp:902
    bool have_default_acceleration = config.has("default_acceleration") && config.opt_float_nullable("default_acceleration", variant_index) > 0;

    for (auto el : {"outer_wall_acceleration", "inner_wall_acceleration", "initial_layer_acceleration", "initial_layer_travel_acceleration",
        "top_surface_acceleration", "travel_acceleration", "bridge_acceleration", "sparse_infill_acceleration", "internal_solid_infill_acceleration"})
        toggle_field(el, have_default_acceleration, variant_index);

    // ConfigManipulation.cpp:908
    bool machine_supports_junction_deviation = context.machine_supports_junction_deviation;
    if (!machine_supports_junction_deviation && gcf_is_marlin_firmware && config.has("machine_max_junction_deviation")) {
        if (const auto *machine_jd = config.option<ConfigOptionFloats>("machine_max_junction_deviation")) {
            machine_supports_junction_deviation = !machine_jd->values.empty() && machine_jd->values.front() > 0.0;
        }
    }
    toggle_line("default_junction_deviation", gcf_is_marlin_firmware, variant_index);
    if (machine_supports_junction_deviation) {
        toggle_field("default_junction_deviation", true, variant_index);
        toggle_field("default_jerk", false, variant_index);
        for (auto el : { "outer_wall_jerk", "inner_wall_jerk", "initial_layer_jerk", "initial_layer_travel_jerk", "top_surface_jerk", "travel_jerk", "infill_jerk"})
            toggle_line(el, false, variant_index);
    } else {
        toggle_field("default_junction_deviation", false, variant_index);
        toggle_field("default_jerk", true, variant_index);
        bool have_default_jerk = config.has("default_jerk") && config.opt_float_nullable("default_jerk", variant_index) > 0;
        for (auto el : { "outer_wall_jerk", "inner_wall_jerk", "initial_layer_jerk", "initial_layer_travel_jerk", "top_surface_jerk", "travel_jerk", "infill_jerk"}) {
            toggle_line(el, true, variant_index);
            toggle_field(el, have_default_jerk, variant_index);
        }
    }

    // ConfigManipulation.cpp:930
    bool have_skirt = config.has("skirt_loops") && config.opt_int("skirt_loops") > 0;
    toggle_field("skirt_height", have_skirt && (!config.has("draft_shield") || config.opt_enum<DraftShield>("draft_shield") != dsEnabled));
    toggle_line("single_loop_draft_shield", have_skirt);
    for (auto el : {"skirt_type", "min_skirt_length", "skirt_distance", "skirt_start_angle", "skirt_speed", "draft_shield"})
        toggle_field(el, have_skirt);

    // ConfigManipulation.cpp:936
    bool have_brim = config.has("brim_type") && (config.opt_enum<BrimType>("brim_type") != btNoBrim);
    toggle_field("brim_object_gap", have_brim);
    toggle_field("brim_use_efc_outline", have_brim);
    toggle_field("combine_brims", have_brim);
    bool have_brim_width = have_brim && config.opt_enum<BrimType>("brim_type") != btAutoBrim &&
                           config.opt_enum<BrimType>("brim_type") != btPainted;
    toggle_field("brim_width", have_brim_width);
    toggle_field("brim_flow_ratio", have_brim);
    toggle_field("outer_wall_filament_id", have_perimeters || have_brim);
    toggle_field("inner_wall_filament_id", have_perimeters || have_brim);

    // ConfigManipulation.cpp:949
    const BrimType brim_type = config.has("brim_type") ? config.opt_enum<BrimType>("brim_type") : btNoBrim;
    const bool have_auto_brim_ear = brim_type == btEar;
    const bool have_painted_brim_ear = brim_type == btPainted;
    set_option_label("brim_width", have_auto_brim_ear ? "Brim ear radius" : "Brim width");
    const auto brim_width = config.has("brim_width") ? config.opt_float("brim_width") : 0.0;
    toggle_field("brim_ears_max_angle", brim_width > 0.0f);
    toggle_field("brim_ears_detection_length", brim_width > 0.0f);
    toggle_field("brim_ears_outer_only", have_painted_brim_ear || brim_width > 0.0f);
    toggle_line("brim_ears_max_angle", have_auto_brim_ear);
    toggle_line("brim_ears_detection_length", have_auto_brim_ear);
    toggle_line("brim_ears_outer_only", have_auto_brim_ear || have_painted_brim_ear);

    // ConfigManipulation.cpp:962
    bool elefant_foot_active = false;
    if (config.has("elefant_foot_compensation") && config.opt_float("elefant_foot_compensation") > 0)
        elefant_foot_active = true;
    if (config.has("elefant_foot_layers_density") && config.option<ConfigOptionPercent>("elefant_foot_layers_density")->get_abs_value(1.0f) < 1.0f)
        elefant_foot_active = true;
    toggle_line("elefant_foot_compensation_layers", elefant_foot_active);

    // ConfigManipulation.cpp:965
    bool have_raft = config.has("raft_layers") && config.opt_int("raft_layers") > 0;
    bool have_support_material = (config.has("enable_support") && config.opt_bool("enable_support")) || have_raft;

    SupportType support_type = config.has("support_type") ? config.opt_enum<SupportType>("support_type") : SupportType::stNormal;
    bool have_support_interface = (config.has("support_interface_top_layers") && config.opt_int("support_interface_top_layers") > 0) ||
                                  (config.has("support_interface_bottom_layers") && config.opt_int("support_interface_bottom_layers") > 0);
    bool have_support_soluble = have_support_material && config.has("support_top_z_distance") && config.opt_float("support_top_z_distance") == 0;
    auto support_style = config.has("support_style") ? config.opt_enum<SupportMaterialStyle>("support_style") : SupportMaterialStyle::smsDefault;
    for (auto el : { "support_style", "support_base_pattern",
        "support_base_pattern_spacing", "support_expansion", "support_angle",
        "support_interface_pattern", "support_interface_top_layers", "support_interface_bottom_layers",
        "bridge_no_support", "max_bridge_length", "support_top_z_distance", "support_bottom_z_distance",
        "support_type", "support_on_build_plate_only", "support_critical_regions_only", "support_interface_not_for_body",
        "support_object_xy_distance", "support_object_first_layer_gap", "independent_support_layer_height"})
        toggle_field(el, have_support_material);
    toggle_field("support_threshold_angle", have_support_material && is_auto(support_type));
    toggle_field("support_threshold_overlap", config.has("support_threshold_angle") && config.opt_int("support_threshold_angle") == 0 && have_support_material && is_auto(support_type));

    // ConfigManipulation.cpp:984
    bool support_is_tree = config.has("enable_support") && config.opt_bool("enable_support") && is_tree(support_type);
    bool support_is_organic = support_is_tree && (support_style == smsTreeOrganic || support_style == smsDefault);
    bool support_is_normal_tree = support_is_tree && !support_is_organic;

    toggle_line("support_threshold_overlap", !support_is_tree);
    for (auto el : {"tree_support_branch_angle", "tree_support_branch_distance", "tree_support_branch_diameter", "tree_support_auto_brim", "tree_support_brim_width"})
        toggle_line(el, support_is_normal_tree);
    for (auto el : {"tree_support_branch_angle_organic", "tree_support_branch_distance_organic", "tree_support_branch_diameter_organic", "tree_support_angle_slow", "tree_support_tip_diameter", "tree_support_top_rate", "tree_support_branch_diameter_angle"})
        toggle_line(el, support_is_organic);
    toggle_line("independent_support_layer_height", have_support_material && !support_is_organic);

    toggle_field("tree_support_brim_width", support_is_tree && (!config.has("tree_support_auto_brim") || !config.opt_bool("tree_support_auto_brim")));
    toggle_line("max_bridge_length", support_is_tree);
    toggle_line("bridge_no_support", !support_is_tree);
    toggle_line("support_critical_regions_only", is_auto(support_type) && support_is_tree);

    // ConfigManipulation.cpp:1005
    for (auto el : { "support_interface_filament",
        "support_interface_loop_pattern", "support_bottom_interface_spacing" })
        toggle_field(el, have_support_material && have_support_interface);

    bool can_ironing_support = have_raft || (have_support_material && config.has("support_interface_top_layers") && config.opt_int("support_interface_top_layers") > 0);
    toggle_field("support_ironing", can_ironing_support);
    bool has_support_ironing = can_ironing_support && config.has("support_ironing") && config.opt_bool("support_ironing");
    for (auto el : {"support_ironing_pattern", "support_ironing_flow", "support_ironing_spacing" })
        toggle_line(el, has_support_ironing);
    toggle_field("support_interface_spacing", have_support_material && have_support_interface && !has_support_ironing);

    // ConfigManipulation.cpp:1024
    for (auto el : {"small_support_perimeter_speed", "small_support_perimeter_threshold"})
        toggle_field(el, config.has("enable_support") && config.opt_bool("enable_support"));

    toggle_field("inner_wall_line_width", have_perimeters || have_skirt || have_brim);
    toggle_field("support_filament", have_support_material || have_skirt);

    toggle_line("raft_contact_distance", have_raft && !have_support_soluble);

    toggle_field("raft_first_layer_density", have_support_material);
    toggle_field("raft_first_layer_expansion",
                 have_support_material && ((!support_is_normal_tree || support_style == smsTreeHybrid) || have_raft));

    // ConfigManipulation.cpp:1042
    bool has_ironing = config.has("ironing_type") && (config.opt_enum<IroningType>("ironing_type") != IroningType::NoIroning);
    for (auto el : { "ironing_pattern", "ironing_flow", "ironing_spacing", "ironing_angle", "ironing_inset", "ironing_angle_fixed" })
        toggle_line(el, has_ironing);
    bool has_rectilinear_ironing = config.has("ironing_pattern") && (config.opt_enum<InfillPattern>("ironing_pattern") == InfillPattern::ipRectilinear);
    for (auto el : {"ironing_angle", "ironing_angle_fixed"})
        toggle_field(el, has_ironing && has_rectilinear_ironing);

    toggle_line("ironing_speed", has_ironing || has_support_ironing);

    // ConfigManipulation.cpp:1051
    bool has_zaa = config.has("zaa_enabled") && config.opt_bool("zaa_enabled");
    for (auto el : {"zaa_minimize_perimeter_height", "zaa_min_z", "zaa_dont_alternate_fill_direction", "ironing_expansion"})
        toggle_line(el, has_zaa);

    // ConfigManipulation.cpp:1056
    bool have_sequential_printing = config.has("print_sequence") && (config.opt_enum<PrintSequence>("print_sequence") == PrintSequence::ByObject);
    toggle_field("print_order", !have_sequential_printing);

    // ConfigManipulation.cpp:1060
    toggle_field("single_extruder_multi_material", !is_BBL_Printer);

    auto bSEMM = context.single_extruder_multi_material || (config.has("single_extruder_multi_material") && config.opt_bool("single_extruder_multi_material"));
    const bool supports_wipe_tower_2 = context.supports_wipe_tower_2 ||
        (!is_BBL_Printer && config.has("wipe_tower_type") && config.opt_enum<WipeTowerType>("wipe_tower_type") == WipeTowerType::Type2);

    toggle_field("ooze_prevention", !bSEMM);
    bool have_ooze_prevention = config.has("ooze_prevention") && config.opt_bool("ooze_prevention");
    toggle_line("standby_temperature_delta", have_ooze_prevention);
    toggle_line("preheat_time", have_ooze_prevention);
    int preheat_steps = config.has("preheat_steps") ? config.opt_int("preheat_steps") : 0;
    toggle_line("preheat_steps", have_ooze_prevention && (preheat_steps > 0));

    // ConfigManipulation.cpp:1072
    bool have_prime_tower = config.has("enable_prime_tower") && config.opt_bool("enable_prime_tower");
    for (auto el : {"prime_tower_width", "prime_tower_brim_width", "prime_tower_skip_points", "wipe_tower_wall_type", "prime_tower_infill_gap","prime_tower_enable_framework", "enable_tower_interface_features"})
        toggle_line(el, have_prime_tower);

    toggle_line("enable_tower_interface_cooldown_during_tower",
                have_prime_tower && config.has("enable_tower_interface_features") && config.opt_bool("enable_tower_interface_features"));

    bool purge_in_primetower = context.purge_in_prime_tower || (config.has("purge_in_prime_tower") && config.opt_bool("purge_in_prime_tower"));

    for (auto el : {"wipe_tower_rotation_angle", "wipe_tower_cone_angle",
                    "wipe_tower_extra_spacing", "wipe_tower_max_purge_speed",
                    "wipe_tower_bridging", "wipe_tower_extra_flow"})
            toggle_line(el, have_prime_tower && supports_wipe_tower_2);

    toggle_line("wipe_tower_no_sparse_layers", have_prime_tower);
    toggle_line("wipe_tower_sparse_layers_combination", have_prime_tower && (!config.has("wipe_tower_no_sparse_layers") || !config.opt_bool("wipe_tower_no_sparse_layers")));

    WipeTowerWallType wipe_tower_wall_type = config.has("wipe_tower_wall_type") ? config.opt_enum<WipeTowerWallType>("wipe_tower_wall_type") : WipeTowerWallType::wtwRectangle;
    bool have_rib_wall = (wipe_tower_wall_type == WipeTowerWallType::wtwRib) && have_prime_tower;
    toggle_line("wipe_tower_cone_angle", have_prime_tower && supports_wipe_tower_2 && wipe_tower_wall_type == WipeTowerWallType::wtwCone);
    toggle_line("wipe_tower_extra_rib_length", have_rib_wall);
    toggle_line("wipe_tower_rib_width", have_rib_wall);
    toggle_line("wipe_tower_fillet_wall", have_rib_wall);
    toggle_field("prime_tower_width", have_prime_tower && !have_rib_wall);

    toggle_line("single_extruder_multi_material_priming", !bSEMM && have_prime_tower && supports_wipe_tower_2);

    bool use_cyclic_ordering = config.has("toolchange_ordering") && config.opt_enum<ToolChangeOrderingType>("toolchange_ordering") == ToolChangeOrderingType::Cyclic;
    toggle_line("toolchange_cyclic_order", use_cyclic_ordering);
    toggle_line("toolchange_cyclic_first_layer", use_cyclic_ordering);

    toggle_line("prime_volume", have_prime_tower && (!purge_in_primetower || !bSEMM));

    for (auto el : {"flush_into_infill", "flush_into_support", "flush_into_objects"})
        toggle_field(el, have_prime_tower);

    // ConfigManipulation.cpp:1110
    bool have_avoid_crossing_perimeters = config.has("reduce_crossing_wall") && config.opt_bool("reduce_crossing_wall");
    toggle_line("max_travel_detour_distance", have_avoid_crossing_perimeters);

    bool has_set_other_flow_ratios = config.has("set_other_flow_ratios") && config.opt_bool("set_other_flow_ratios");
    for (auto el : {"first_layer_flow_ratio", "outer_wall_flow_ratio", "inner_wall_flow_ratio", "overhang_flow_ratio", "sparse_infill_flow_ratio", "internal_solid_infill_flow_ratio", "gap_fill_flow_ratio", "support_flow_ratio", "support_interface_flow_ratio"})
        toggle_line(el, has_set_other_flow_ratios);

    bool has_overhang_speed = config.has("enable_overhang_speed") && config.opt_bool_nullable("enable_overhang_speed", variant_index);
    for (auto el : {"overhang_1_4_speed", "overhang_2_4_speed", "overhang_3_4_speed", "overhang_4_4_speed"})
        toggle_line(el, has_overhang_speed, variant_index);

    toggle_line("slowdown_for_curled_perimeters", has_overhang_speed, variant_index);

    toggle_line("flush_into_objects", !is_global_config);

    int support_iface_fil = config.has("support_interface_filament") ? config.opt_int("support_interface_filament") : 0;
    int support_fil = config.has("support_filament") ? config.opt_int("support_filament") : 0;
    toggle_line("support_interface_not_for_body", support_iface_fil && !support_fil);

    // ConfigManipulation.cpp:1128
    bool has_fuzzy_skin = config.has("fuzzy_skin") && (config.opt_enum<FuzzySkinType>("fuzzy_skin") != FuzzySkinType::Disabled_fuzzy);

    for (auto el : {"fuzzy_skin_mode", "fuzzy_skin_noise_type", "fuzzy_skin_point_distance", "fuzzy_skin_thickness", "fuzzy_skin_first_layer"})
        toggle_line(el, has_fuzzy_skin);

    NoiseType fuzzy_skin_noise_type = config.has("fuzzy_skin_noise_type") ? config.opt_enum<NoiseType>("fuzzy_skin_noise_type") : NoiseType::Classic;
    const bool is_ripple = fuzzy_skin_noise_type == NoiseType::Ripple;
    toggle_line("fuzzy_skin_scale", fuzzy_skin_noise_type != NoiseType::Classic && has_fuzzy_skin && !is_ripple);
    toggle_line("fuzzy_skin_octaves", fuzzy_skin_noise_type != NoiseType::Classic && fuzzy_skin_noise_type != NoiseType::Voronoi && has_fuzzy_skin && !is_ripple);
    toggle_line("fuzzy_skin_persistence", (fuzzy_skin_noise_type == NoiseType::Perlin || fuzzy_skin_noise_type == NoiseType::Billow) && has_fuzzy_skin && !is_ripple);
    toggle_line("fuzzy_skin_ripples_per_layer", is_ripple && has_fuzzy_skin);
    toggle_line("fuzzy_skin_ripple_offset", is_ripple && has_fuzzy_skin);
    toggle_line("fuzzy_skin_layers_between_ripple_offset", is_ripple && has_fuzzy_skin);

    // ConfigManipulation.cpp:1144
    bool have_arachne = config.has("wall_generator") && (config.opt_enum<PerimeterGeneratorType>("wall_generator") == PerimeterGeneratorType::Arachne);
    for (auto el : {"wall_transition_length", "wall_transition_filter_deviation", "wall_transition_angle", "min_feature_size", "min_length_factor",
        "min_bead_width", "wall_distribution_count", "initial_layer_min_bead_width", "wall_maximum_resolution", "wall_maximum_deviation"})
        toggle_line(el, have_arachne);
    toggle_field("detect_thin_wall", !have_arachne);

    auto is_role_based_wipe_speed = config.has("role_based_wipe_speed") && config.opt_bool("role_based_wipe_speed");
    toggle_field("wipe_speed", !is_role_based_wipe_speed);

    const bool have_wipe_inward = config.has("wipe_inward") && config.opt_bool("wipe_inward");
    toggle_line("wipe_inward_distance", have_wipe_inward);

    for (auto el : {"accel_to_decel_enable", "accel_to_decel_factor"})
        toggle_line(el, gcf_is_klipper);
    if (gcf_is_klipper)
        toggle_field("accel_to_decel_factor", config.has("accel_to_decel_enable") && config.opt_bool("accel_to_decel_enable"));

    bool have_make_overhang_printable = config.has("make_overhang_printable") && config.opt_bool("make_overhang_printable");
    toggle_line("make_overhang_printable_angle", have_make_overhang_printable);
    toggle_line("make_overhang_printable_hole_size", have_make_overhang_printable);

    // ConfigManipulation.cpp:1167
    toggle_line("only_one_wall_first_layer", has_bottom_shell);
    toggle_line("only_one_wall_top", has_top_shell_layers);
    float min_len_fac = config.has("min_length_factor") ? config.opt_float("min_length_factor") : 0.0f;
    toggle_line("min_width_top_surface", (has_top_shell_layers && config.has("only_one_wall_top") && config.opt_bool("only_one_wall_top")) || ((min_len_fac > 0.5f) && have_arachne));

    for (auto el : { "hole_to_polyhole_threshold", "hole_to_polyhole_twisted", "hole_to_polyhole_max_edges" })
        toggle_line(el, config.has("hole_to_polyhole") && config.opt_bool("hole_to_polyhole"));

    bool has_detect_overhang_wall = config.has("detect_overhang_wall") && config.opt_bool("detect_overhang_wall");
    bool has_overhang_reverse     = config.has("overhang_reverse") && config.opt_bool("overhang_reverse");
    bool allow_overhang_reverse   = !has_spiral_vase;
    toggle_line("unsupported_wall_last", has_detect_overhang_wall);
    toggle_line("overhang_reverse", allow_overhang_reverse);
    toggle_line("overhang_reverse_internal_only", allow_overhang_reverse && has_overhang_reverse);
    bool has_overhang_reverse_internal_only = config.has("overhang_reverse_internal_only") && config.opt_bool("overhang_reverse_internal_only");
    if (has_overhang_reverse_internal_only) {
        result.fixes.push_back({"overhang_reverse_threshold", "0%", "Reset overhang reverse threshold to 0% when internal only"});
    }
    toggle_line("overhang_reverse_threshold", has_detect_overhang_wall && allow_overhang_reverse && has_overhang_reverse && !has_overhang_reverse_internal_only);
    toggle_line("timelapse_type", is_BBL_Printer);

    bool have_small_area_infill_flow_compensation = config.has("small_area_infill_flow_compensation") && config.opt_bool("small_area_infill_flow_compensation");
    toggle_line("small_area_infill_flow_compensation_model", have_small_area_infill_flow_compensation);

    // ConfigManipulation.cpp:1195
    toggle_field("seam_slope_type", !has_spiral_vase);
    bool has_seam_slope = !has_spiral_vase && config.has("seam_slope_type") && (config.opt_enum<SeamScarfType>("seam_slope_type") != SeamScarfType::None);
    toggle_line("seam_slope_conditional", has_seam_slope);
    toggle_line("seam_slope_start_height", has_seam_slope);
    toggle_line("seam_slope_entire_loop", has_seam_slope);
    toggle_line("seam_slope_min_length", has_seam_slope);
    toggle_line("seam_slope_steps", has_seam_slope);
    toggle_line("seam_slope_inner_walls", has_seam_slope);
    toggle_line("scarf_joint_speed", has_seam_slope);
    toggle_line("scarf_joint_flow_ratio", has_seam_slope);
    toggle_field("seam_slope_min_length", !config.has("seam_slope_entire_loop") || !config.opt_bool("seam_slope_entire_loop"));
    toggle_line("scarf_angle_threshold", has_seam_slope && config.has("seam_slope_conditional") && config.opt_bool("seam_slope_conditional"));
    toggle_line("scarf_overhang_threshold", has_seam_slope && config.has("seam_slope_conditional") && config.opt_bool("seam_slope_conditional"));

    // ConfigManipulation.cpp:1209
    bool use_beam_interlocking = config.has("interlocking_beam") && config.opt_bool("interlocking_beam");
    toggle_line("mmu_segmented_region_interlocking_depth", !use_beam_interlocking);
    toggle_line("interlocking_beam_width", use_beam_interlocking);
    toggle_line("interlocking_orientation", use_beam_interlocking);
    toggle_line("interlocking_beam_layer_count", use_beam_interlocking);
    toggle_line("interlocking_depth", use_beam_interlocking);
    toggle_line("interlocking_boundary_avoidance", use_beam_interlocking);

    bool lattice_options = pattern == InfillPattern::ipLateralLattice;
    for (auto el : { "lateral_lattice_angle_1", "lateral_lattice_angle_2"})
        toggle_line(el, lattice_options);

    bool lightning_options = pattern == InfillPattern::ipLightning;
    for (auto el : { "lightning_overhang_angle", "lightning_prune_angle", "lightning_straightening_angle" })
        toggle_line(el, lightning_options);

    // ConfigManipulation.cpp:1226
    bool FillAdaptive = (pattern == InfillPattern::ipAdaptiveCubic || pattern == InfillPattern::ipSupportCubic);

    toggle_field("sparse_infill_rotate_template", !FillAdaptive);
    toggle_field("infill_direction", (!config.has("sparse_infill_rotate_template") || config.opt_string("sparse_infill_rotate_template") == "") && !FillAdaptive);
    toggle_field("solid_infill_direction", !config.has("solid_infill_rotate_template") || config.opt_string("solid_infill_rotate_template") == "");

    toggle_line("infill_overhang_angle", pattern == InfillPattern::ipLateralHoneycomb);

    // ConfigManipulation.cpp:1235
    toggle_line("enable_wrapping_detection", context.support_wrapping_detection);

    // Tab.cpp:3348
    if (context.is_plate_config) {
        bool support_multi = (config.has("support_multi_bed_types") && config.opt_bool("support_multi_bed_types")) || context.support_multi_bed_types;
        toggle_field("curr_bed_type", is_BBL_Printer || support_multi);
    }

    // Tab.cpp:3689-3690
    if (context.is_plate_config) {
        bool has_mixed = false;
        if (config.has("filament_is_mixed")) {
            const auto* opt = config.option<ConfigOptionBools>("filament_is_mixed");
            if (opt) {
                for (unsigned char v : opt->values) {
                    if (v) { has_mixed = true; break; }
                }
            }
        }
        if (!has_mixed) {
            for (bool b : context.is_mixed_filament) {
                if (b) { has_mixed = true; break; }
            }
        }
        toggle_field("first_layer_sequence_choice", !has_mixed);
        toggle_field("other_layers_sequence_choice", !has_mixed);
    }
}

// ConfigManipulation.cpp:1248
void update_print_sla_config(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    // ConfigManipulation.cpp:1250
    if (config.has("support_head_penetration") && config.has("support_head_width")) {
        double head_penetration = config.opt_float("support_head_penetration");
        double head_width = config.opt_float("support_head_width");
        if (head_penetration > head_width) {
            result.fixes.push_back({
                "support_head_penetration",
                std::to_string(head_width),
                "Head penetration should not be greater than the head width."
            });
        }
    }

    // ConfigManipulation.cpp:1262
    if (config.has("support_head_front_diameter") && config.has("support_pillar_diameter")) {
        double pinhead_d = config.opt_float("support_head_front_diameter");
        double pillar_d = config.opt_float("support_pillar_diameter");
        if (pinhead_d > pillar_d) {
            result.fixes.push_back({
                "support_head_front_diameter",
                std::to_string(pillar_d / 2.0),
                "Pinhead diameter should be smaller than the pillar diameter."
            });
        }
    }
}

// ConfigManipulation.cpp:1284
void toggle_print_sla_options(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    (void)context;
    auto toggle_field = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].enabled = toggle;
    };

    // ConfigManipulation.cpp:1286
    bool supports_en = config.has("supports_enable") && config.opt_bool("supports_enable");

    toggle_field("support_head_front_diameter", supports_en);
    toggle_field("support_head_penetration", supports_en);
    toggle_field("support_head_width", supports_en);
    toggle_field("support_pillar_diameter", supports_en);
    toggle_field("support_small_pillar_diameter_percent", supports_en);
    toggle_field("support_max_bridges_on_pillar", supports_en);
    toggle_field("support_pillar_connection_mode", supports_en);
    toggle_field("support_buildplate_only", supports_en);
    toggle_field("support_base_diameter", supports_en);
    toggle_field("support_base_height", supports_en);
    toggle_field("support_base_safety_distance", supports_en);
    toggle_field("support_critical_angle", supports_en);
    toggle_field("support_max_bridge_length", supports_en);
    toggle_field("support_max_pillar_link_distance", supports_en);
    toggle_field("support_points_density_relative", supports_en);
    toggle_field("support_points_minimal_distance", supports_en);

    // ConfigManipulation.cpp:1305
    bool pad_en = config.has("pad_enable") && config.opt_bool("pad_enable");

    toggle_field("pad_wall_thickness", pad_en);
    toggle_field("pad_wall_height", pad_en);
    toggle_field("pad_brim_size", pad_en);
    toggle_field("pad_max_merge_distance", pad_en);
    // toggle_field("pad_edge_radius", supports_en);
    toggle_field("pad_wall_slope", pad_en);
    toggle_field("pad_around_object", pad_en);
    toggle_field("pad_around_object_everywhere", pad_en);

    // ConfigManipulation.cpp:1316
    bool zero_elev = config.has("pad_around_object") && config.opt_bool("pad_around_object") && pad_en;

    toggle_field("support_object_elevation", supports_en && !zero_elev);
    toggle_field("pad_object_gap", zero_elev);
    toggle_field("pad_around_object_everywhere", zero_elev);
    toggle_field("pad_object_connector_stride", zero_elev);
    toggle_field("pad_object_connector_width", zero_elev);
    toggle_field("pad_object_connector_penetration", zero_elev);
}

// Tab.cpp:6222
void toggle_printer_options(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    auto toggle_field = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].enabled = toggle;
    };
    auto toggle_line = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].visible = toggle;
    };

    // Tab.cpp:6224
    if (config.has("printer_technology") && config.opt_enum<PrinterTechnology>("printer_technology") == ptSLA)
        return;

    // Tab.cpp:6233
    bool is_BBL_printer = context.is_bbl_printer;

    // Tab.cpp:6245
    for (auto el : {"scan_first_layer", "bbl_calib_mark_logo", "bbl_use_printhost"})
        toggle_line(el, is_BBL_printer);

    // Tab.cpp:6249
    for (auto el : {"use_firmware_retraction", "use_relative_e_distances", "support_multi_bed_types", "pellet_modded_printer", "bed_mesh_max", "bed_mesh_min", "bed_mesh_probe_distance", "adaptive_bed_mesh_margin", "thumbnails"})
        toggle_line(el, !is_BBL_printer);

    // Tab.cpp:6251
    bool gcf_is_marlin_firmware = config.has("gcode_flavor") && config.option<ConfigOptionEnum<GCodeFlavor>>("gcode_flavor")->value == GCodeFlavor::gcfMarlinFirmware;
    // Tab.cpp:6252
    toggle_line("enable_power_loss_recovery", is_BBL_printer || gcf_is_marlin_firmware);

    // Tab.cpp:6254
    const bool support_parallel_printheads = (config.has("support_parallel_printheads") && config.opt_bool("support_parallel_printheads")) || context.support_parallel_printheads;
    // Tab.cpp:6255
    toggle_line("parallel_printheads_count", support_parallel_printheads);

    // Tab.cpp:6257
    toggle_line("fan_direction", config.has("auxiliary_fan") && config.opt_bool("auxiliary_fan"));

    // Tab.cpp:6260-6261
    bool support_cooling_filter = config.has("support_cooling_filter") && config.opt_bool("support_cooling_filter");
    toggle_line("support_air_filtration", !support_cooling_filter);
    toggle_line("cooling_filter_enabled", support_cooling_filter);

    // Tab.cpp:6268
    toggle_line("wrapping_detection_gcode", context.support_wrapping_detection);

    // Tab.cpp:6272
    bool is_type2 = config.has("wipe_tower_type") && (config.opt_enum<WipeTowerType>("wipe_tower_type") == WipeTowerType::Type2);
    const bool supports_wipe_tower_2 = !is_BBL_printer && (is_type2 || context.supports_wipe_tower_2);
    // Tab.cpp:6273
    toggle_line("wipe_tower_type", !is_BBL_printer);

    // Tab.cpp:6283
    for (auto el : {
             "enable_filament_ramming",
             "cooling_tube_retraction",
             "cooling_tube_length",
             "parking_pos_retraction",
             "extra_loading_move",
             "high_current_on_filament_swap",
         })
        toggle_field(el, supports_wipe_tower_2);

    // Tab.cpp:6285
    auto bSEMM = (config.has("single_extruder_multi_material") && config.opt_bool("single_extruder_multi_material")) || context.single_extruder_multi_material;
    // Tab.cpp:6286
    if (!bSEMM && config.has("manual_filament_change") && config.opt_bool("manual_filament_change")) {
        result.fixes.push_back({
            "manual_filament_change",
            "false",
            "Manual filament change requires single extruder multi-material mode; reset to false."
        });
    }
    // Tab.cpp:6291
    toggle_field("extruders_count", !bSEMM);
    // Tab.cpp:6292
    toggle_field("manual_filament_change", bSEMM);
    // Tab.cpp:6293
    toggle_field("purge_in_prime_tower", bSEMM && supports_wipe_tower_2);

    // Tab.cpp:6298
    size_t extruders_count = 1;
    if (config.has("nozzle_diameter")) {
        extruders_count = config.option<ConfigOptionFloats>("nozzle_diameter")->size();
    } else if (context.extruders_count > 0) {
        extruders_count = context.extruders_count;
    }
    // Tab.cpp:6299
    toggle_field("tool_change_on_wipe_tower", !bSEMM && supports_wipe_tower_2 && extruders_count > 1);
    // Tab.cpp:6300
    toggle_field("wait_for_temp_on_wipe_tower", !bSEMM && supports_wipe_tower_2 && extruders_count > 1);

    // Tab.cpp:6303
    int variant_index = context.variant_index >= 0 ? context.variant_index : 0;
    int opt_idx = variant_index;

    bool have_retract_length = config.has("retraction_length") && config.opt_float("retraction_length", variant_index) > 0;

    // Tab.cpp:6311
    toggle_field("extruder_printable_area", false, opt_idx);
    // Tab.cpp:6312
    toggle_line("extruder_printable_area", extruders_count == 2, opt_idx);
    // Tab.cpp:6313
    toggle_field("extruder_printable_height", false, opt_idx);
    // Tab.cpp:6314
    toggle_line("extruder_printable_height", extruders_count == 2, opt_idx);

    // Tab.cpp:6317
    bool use_firmware_retraction = config.has("use_firmware_retraction") && config.opt_bool("use_firmware_retraction");
    // Tab.cpp:6318
    toggle_field("retract_length", !use_firmware_retraction, opt_idx);

    // Tab.cpp:6322
    toggle_field("retraction_minimum_travel", have_retract_length || use_firmware_retraction, opt_idx);

    // Tab.cpp:6326
    bool retraction = have_retract_length || use_firmware_retraction;
    // Tab.cpp:6329
    for (auto el : {"z_hop", "retract_when_changing_layer"})
        toggle_field(el, retraction, opt_idx);

    // Tab.cpp:6335
    double z_hop_val = config.has("z_hop") ? config.opt_float("z_hop", variant_index) : 0.0;
    for (auto el : {"retract_lift_above", "retract_lift_below", "retract_lift_enforce"})
        toggle_field(el, retraction && (z_hop_val > 0.0), opt_idx);

    // Tab.cpp:6343
    for (auto el : {"retraction_speed", "deretraction_speed", "retract_before_wipe", "retract_after_wipe",
                    "retract_length", "retract_restart_extra", "wipe_distance"})
        toggle_field(el, retraction && !use_firmware_retraction, opt_idx);

    // Tab.cpp:6346
    bool wipe = retraction && config.has("wipe") && config.opt_bool("wipe", variant_index);
    double retract_before_wipe = 0.0;
    if (config.has("retract_before_wipe")) {
        const auto* opt = config.option<ConfigOptionPercents>("retract_before_wipe");
        if (opt && variant_index < (int)opt->values.size())
            retract_before_wipe = opt->get_at(variant_index);
    }
    double retract_after_wipe = 0.0;
    if (config.has("retract_after_wipe")) {
        const auto* opt = config.option<ConfigOptionPercents>("retract_after_wipe");
        if (opt && variant_index < (int)opt->values.size())
            retract_after_wipe = opt->get_at(variant_index);
    }

    // Tab.cpp:6351
    toggle_field("retract_before_wipe", wipe && !is_approx(retract_after_wipe, 100.), opt_idx);
    // Tab.cpp:6352
    toggle_field("retract_after_wipe", wipe && !is_approx(retract_before_wipe, 100.), opt_idx);

    // Tab.cpp:6354-6376
    if (use_firmware_retraction && wipe && retract_before_wipe < 100.0) {
        result.fixes.push_back({
            "wipe",
            "false",
            "The Retract before wipe option could be only 100% when using the Firmware Retraction mode. [Yes: Set retract_before_wipe to 100% and disable wipe]"
        });
        result.fixes.push_back({
            "retract_before_wipe",
            "100%",
            "The Retract before wipe option could be only 100% when using the Firmware Retraction mode. [Yes: Set retract_before_wipe to 100% and disable wipe]"
        });
        result.fixes.push_back({
            "use_firmware_retraction",
            "false",
            "The Retract before wipe option could be only 100% when using the Firmware Retraction mode. [No: Keep wipe and disable firmware retraction]"
        });
    }

    // Tab.cpp:6378
    toggle_field("wipe_distance", wipe, opt_idx);

    // Tab.cpp:6380
    bool have_multiple_extruders = true; // Tab.cpp:6236
    toggle_field("retract_length_toolchange", have_multiple_extruders, opt_idx);

    // Tab.cpp:6382
    bool toolchange_retraction = config.has("retract_length_toolchange") && config.opt_float("retract_length_toolchange", variant_index) > 0;
    // Tab.cpp:6383
    toggle_field("retract_restart_extra_toolchange", have_multiple_extruders && toolchange_retraction, opt_idx);

    // Tab.cpp:6385
    int enable_long_retract_cut = config.has("enable_long_retraction_when_cut") ? config.opt_int("enable_long_retraction_when_cut") : 0;
    toggle_field("long_retractions_when_cut", !use_firmware_retraction && enable_long_retract_cut, opt_idx);

    // Tab.cpp:6386
    bool long_retract_cut = config.has("long_retractions_when_cut") && config.opt_bool("long_retractions_when_cut", variant_index);
    toggle_line("retraction_distances_when_cut", long_retract_cut, opt_idx);

    // Tab.cpp:6388
    bool travel_slope_toggle = false;
    if (config.has("z_hop_types")) {
        travel_slope_toggle = (config.opt_enum("z_hop_types", variant_index) != ZHopType::zhtNormal);
    }
    toggle_field("travel_slope", travel_slope_toggle, opt_idx);

    // Tab.cpp:6392
    GCodeFlavor gcf = config.has("gcode_flavor") ? config.option<ConfigOptionEnum<GCodeFlavor>>("gcode_flavor")->value : GCodeFlavor::gcfMarlinFirmware;
    const bool gcf_is_marlin_legacy = gcf == GCodeFlavor::gcfMarlinLegacy;
    const bool gcf_is_klipper = gcf == GCodeFlavor::gcfKlipper;
    const bool gcf_is_reprap_firmware = gcf == GCodeFlavor::gcfRepRapFirmware;

    // Tab.cpp:6402
    bool silent_mode = config.has("silent_mode") && config.opt_bool("silent_mode");
    int max_field = silent_mode ? 2 : 1;

    // Tab.cpp:6404
    for (int i = 0; i < max_field; ++i)
        toggle_field("machine_max_acceleration_travel", !gcf_is_marlin_legacy && !gcf_is_klipper, i);
    // Tab.cpp:6405
    toggle_line("machine_max_acceleration_travel", !gcf_is_marlin_legacy && !gcf_is_klipper);

    // Tab.cpp:6407
    for (int i = 0; i < max_field; ++i)
        toggle_field("machine_max_junction_deviation", gcf_is_marlin_firmware, i);
    // Tab.cpp:6408
    toggle_line("machine_max_junction_deviation", gcf_is_marlin_firmware);

    // Tab.cpp:6411
    bool enable_jerk = !gcf_is_marlin_firmware;
    if (gcf_is_marlin_firmware) {
        const auto *junction_deviation = config.option<ConfigOptionFloats>("machine_max_junction_deviation");
        if (junction_deviation != nullptr) {
            const auto &values = junction_deviation->values;
            enable_jerk = std::all_of(values.begin(), values.end(), [](double val) { return val == 0.0; });
        } else {
            enable_jerk = true;
        }
    }
    // Tab.cpp:6422-6425
    for (int i = 0; i < max_field; ++i) {
        toggle_field("machine_max_jerk_x", enable_jerk, i);
        toggle_field("machine_max_jerk_y", enable_jerk, i);
        toggle_field("machine_max_jerk_z", enable_jerk, i);
        toggle_field("machine_max_jerk_e", enable_jerk, i);
    }

    // Tab.cpp:6428
    bool emittable_limits = gcf_is_marlin_legacy || gcf_is_marlin_firmware || gcf_is_reprap_firmware;
    // Tab.cpp:6429
    toggle_field("emit_machine_limits_to_gcode", emittable_limits);

    // Tab.cpp:6431
    bool resonance_avoidance = config.has("resonance_avoidance") && config.opt_bool("resonance_avoidance");
    // Tab.cpp:6432
    toggle_field("min_resonance_avoidance_speed", resonance_avoidance);
    // Tab.cpp:6433
    toggle_field("max_resonance_avoidance_speed", resonance_avoidance);

    // Tab.cpp:6435
    bool input_shaping_compatible = gcf_is_marlin_firmware || gcf_is_reprap_firmware;

    // Tab.cpp:6439
    for (auto is : {"input_shaping_emit", "input_shaping_type", "input_shaping_freq_x", "input_shaping_freq_y",
                    "input_shaping_damp_x", "input_shaping_damp_y"})
        toggle_line(is, input_shaping_compatible);

    // Tab.cpp:6441
    if (input_shaping_compatible) {
        bool emit_machine_limits_to_gcode = config.has("emit_machine_limits_to_gcode") && config.opt_bool("emit_machine_limits_to_gcode");
        // Tab.cpp:6443
        toggle_field("input_shaping_emit", emit_machine_limits_to_gcode);
        bool input_shaping_emit = emit_machine_limits_to_gcode && config.has("input_shaping_emit") && config.opt_bool("input_shaping_emit");
        // Tab.cpp:6445
        toggle_field("input_shaping_type", input_shaping_emit);
        // Tab.cpp:6446
        toggle_field("input_shaping_freq_x", input_shaping_emit);
        // Tab.cpp:6447
        toggle_field("input_shaping_freq_y", input_shaping_emit && !gcf_is_reprap_firmware);
        // Tab.cpp:6448
        toggle_field("input_shaping_damp_x", input_shaping_emit);
        // Tab.cpp:6449
        toggle_field("input_shaping_damp_y", input_shaping_emit && !gcf_is_reprap_firmware);
    } else {
        toggle_field("input_shaping_emit", false);
        toggle_field("input_shaping_type", false);
        toggle_field("input_shaping_freq_x", false);
        toggle_field("input_shaping_freq_y", false);
        toggle_field("input_shaping_damp_x", false);
        toggle_field("input_shaping_damp_y", false);
    }
}

// Tab.cpp:4873
void toggle_filament_options(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    auto toggle_field = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].enabled = toggle;
    };
    auto toggle_line = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].visible = toggle;
    };

    const int variant_index = context.variant_index >= 0 ? context.variant_index : 0;
    bool is_BBL_printer = context.is_bbl_printer;

    // Tab.cpp:4886
    bool has_enable_overhang_bridge_fan = config.has("enable_overhang_bridge_fan") && config.opt_bool("enable_overhang_bridge_fan", 0);
    // Tab.cpp:4888
    for (auto el : {"overhang_fan_speed", "overhang_fan_threshold", "internal_bridge_fan_speed"})
        toggle_field(el, has_enable_overhang_bridge_fan);

    // Tab.cpp:4891
    bool has_slow_down_for_layer_cooling = config.has("slow_down_for_layer_cooling") && config.opt_bool("slow_down_for_layer_cooling", 0);
    // Tab.cpp:4892
    toggle_field("dont_slow_down_outer_wall", has_slow_down_for_layer_cooling);

    // Tab.cpp:4899
    const int close_fan_first_n = config.has("close_fan_the_first_x_layers") ? config.opt_int("close_fan_the_first_x_layers", 0) : 0;
    const bool initial_layer_fan_speed_enabled = close_fan_first_n <= 0;
    // Tab.cpp:4901
    toggle_line("initial_layer_fan_speed", initial_layer_fan_speed_enabled);

    // Tab.cpp:4902-4914
    if (!initial_layer_fan_speed_enabled && config.has("initial_layer_fan_speed")) {
        if (auto* opt = dynamic_cast<const ConfigOptionInts*>(config.option("initial_layer_fan_speed"))) {
            bool needs_reset = false;
            for (int v : opt->values) {
                if (v != -1) { needs_reset = true; break; }
            }
            if (needs_reset) {
                std::string reset_str = "-1";
                for (size_t idx = 1; idx < opt->values.size(); ++idx)
                    reset_str += ",-1";
                result.fixes.push_back({
                    "initial_layer_fan_speed",
                    reset_str,
                    "Initial layer fan speed is disabled when close_fan_the_first_x_layers > 0; reset to -1."
                });
            }
        }
    }

    // Tab.cpp:4917
    bool auxiliary_fan = config.has("auxiliary_fan") && config.opt_bool("auxiliary_fan");
    toggle_line("additional_cooling_fan_speed", auxiliary_fan, variant_index);

    // Tab.cpp:4919
    bool support_air_filtration = config.has("support_air_filtration") && config.opt_bool("support_air_filtration");
    // Tab.cpp:4921
    for (auto el : {"activate_air_filtration", "during_print_exhaust_fan_speed", "complete_print_exhaust_fan_speed"})
        toggle_line(el, support_air_filtration);

    // Tab.cpp:4923
    if (support_air_filtration) {
        bool activate_air_filtration = config.has("activate_air_filtration") && config.opt_bool("activate_air_filtration", 0);
        // Tab.cpp:4925
        toggle_field("activate_air_filtration_during_print", activate_air_filtration);
        // Tab.cpp:4926
        bool during_print = activate_air_filtration && config.has("activate_air_filtration_during_print") && config.opt_bool("activate_air_filtration_during_print", 0);
        toggle_field("during_print_exhaust_fan_speed", during_print);
        // Tab.cpp:4927
        toggle_field("activate_air_filtration_on_completion", activate_air_filtration);
        // Tab.cpp:4928
        bool on_completion = activate_air_filtration && config.has("activate_air_filtration_on_completion") && config.opt_bool("activate_air_filtration_on_completion", 0);
        toggle_field("complete_print_exhaust_fan_speed", on_completion);
    } else {
        toggle_field("activate_air_filtration_during_print", false);
        toggle_field("during_print_exhaust_fan_speed", false);
        toggle_field("activate_air_filtration_on_completion", false);
        toggle_field("complete_print_exhaust_fan_speed", false);
    }

    // Tab.cpp:4932
    bool pa = config.has("enable_pressure_advance") && config.opt_bool("enable_pressure_advance", variant_index);
    // Tab.cpp:4934
    toggle_field("pressure_advance", pa, variant_index);

    // Tab.cpp:4937
    std::string bed_temp_1st_layer_key = "";
    if (context.curr_bed_type >= 0) {
        bed_temp_1st_layer_key = get_bed_temp_1st_layer_key(static_cast<BedType>(context.curr_bed_type));
    } else if (config.has("curr_bed_type")) {
        bed_temp_1st_layer_key = get_bed_temp_1st_layer_key(config.opt_enum<BedType>("curr_bed_type"));
    }

    const std::vector<std::string> bed_temp_keys = {
        "supertack_plate_temp_initial_layer", "cool_plate_temp_initial_layer",
        "textured_cool_plate_temp_initial_layer", "eng_plate_temp_initial_layer",
        "textured_plate_temp_initial_layer", "hot_plate_temp_initial_layer"
    };

    bool support_multi_bed_types = (std::find(bed_temp_keys.begin(), bed_temp_keys.end(), bed_temp_1st_layer_key) == bed_temp_keys.end()) ||
                                   is_BBL_printer ||
                                   context.support_multi_bed_types ||
                                   (config.has("support_multi_bed_types") && config.opt_bool("support_multi_bed_types"));

    // Tab.cpp:4954
    for (const auto& key : bed_temp_keys) {
        toggle_line(key, support_multi_bed_types || bed_temp_1st_layer_key == key);
    }

    // Tab.cpp:4962
    toggle_field("adaptive_pressure_advance", pa, 0);
    // Tab.cpp:4963
    toggle_field("adaptive_pressure_advance_overhangs", pa, 0);
    // Tab.cpp:4964
    bool has_adaptive_pa = config.has("adaptive_pressure_advance") && config.opt_bool("adaptive_pressure_advance", variant_index);
    // Tab.cpp:4965
    toggle_line("adaptive_pressure_advance_overhangs", has_adaptive_pa && pa, 0);
    // Tab.cpp:4966
    toggle_line("adaptive_pressure_advance_model", has_adaptive_pa && pa, 0);
    // Tab.cpp:4967
    toggle_line("adaptive_pressure_advance_bridges", has_adaptive_pa && pa, 0);

    // Tab.cpp:4969
    bool is_pellet_printer = config.has("pellet_modded_printer") && config.opt_bool("pellet_modded_printer");
    // Tab.cpp:4970
    toggle_line("pellet_flow_coefficient", is_pellet_printer);
    // Tab.cpp:4971
    toggle_line("filament_diameter", !is_pellet_printer);

    // Tab.cpp:4973
    bool support_chamber_temp_control = context.support_chamber_temp_control || (config.has("support_chamber_temp_control") && config.opt_bool("support_chamber_temp_control"));
    toggle_line("activate_chamber_temp_control", support_chamber_temp_control);

    // Tab.cpp:4975
    std::string volumetric_speed_cos = config.has("volumetric_speed_coefficients") ? config.opt_string("volumetric_speed_coefficients", variant_index) : "";
    bool enable_fit = !volumetric_speed_cos.empty() && volumetric_speed_cos != "0 0 0 0 0 0";
    // Tab.cpp:4977
    toggle_field("filament_adaptive_volumetric_speed", enable_fit, variant_index);

    // Tab.cpp:4400-4412
    int machine_enabled_level = config.has("enable_long_retraction_when_cut") ? config.option<ConfigOptionInt>("enable_long_retraction_when_cut")->value : 0;
    bool machine_enabled = (machine_enabled_level == LongRectrationLevel::EnableFilament);
    // Tab.cpp:4403
    toggle_line("filament_long_retractions_when_cut", machine_enabled, variant_index);

    bool filament_enabled = false;
    if (config.has("filament_long_retractions_when_cut")) {
        const auto* opt = config.option<ConfigOptionBools>("filament_long_retractions_when_cut");
        if (opt && variant_index < (int)opt->values.size())
            filament_enabled = (opt->values[variant_index] == 1);
    }
    // Tab.cpp:4410
    toggle_line("filament_retraction_distances_when_cut", filament_enabled && machine_enabled, variant_index);

    const auto* opt_vec_cut = config.has("filament_long_retractions_when_cut") ?
        dynamic_cast<const ConfigOptionVectorBase*>(config.option("filament_long_retractions_when_cut")) : nullptr;
    bool is_checked_cut = opt_vec_cut && !opt_vec_cut->is_nil(variant_index);
    toggle_field("filament_long_retractions_when_cut", is_checked_cut && machine_enabled, variant_index);

    const auto* opt_vec_dist = config.has("filament_retraction_distances_when_cut") ?
        dynamic_cast<const ConfigOptionVectorBase*>(config.option("filament_retraction_distances_when_cut")) : nullptr;
    bool is_checked_dist = opt_vec_dist && !opt_vec_dist->is_nil(variant_index);
    toggle_field("filament_retraction_distances_when_cut", is_checked_dist && filament_enabled && machine_enabled, variant_index);

    // Tab.cpp:4985
    toggle_field("filament_minimal_purge_on_wipe_tower", !is_BBL_printer, variant_index);

    // Tab.cpp:4989
    for (auto el : {
        "filament_loading_speed_start", "filament_loading_speed",
        "filament_unloading_speed_start", "filament_unloading_speed",
        "filament_toolchange_delay", "filament_cooling_moves",
        "filament_cooling_initial_speed", "filament_cooling_final_speed"
    })
        toggle_field(el, !is_BBL_printer);

    // Tab.cpp:4991
    bool multitool_ramming = config.has("filament_multitool_ramming") && config.opt_bool("filament_multitool_ramming", variant_index);
    // Tab.cpp:4992
    toggle_field("filament_multitool_ramming_volume", multitool_ramming, variant_index);
    // Tab.cpp:4993
    toggle_field("filament_multitool_ramming_flow", multitool_ramming, variant_index);

    // Tab.cpp:4995
    bool is_BBL_multi_extruder = is_BBL_printer && (
        (config.has("nozzle_diameter") && config.option<ConfigOptionFloats>("nozzle_diameter")->size() > 1) ||
        context.extruders_count > 1
    );
    // Tab.cpp:4996
    toggle_line("long_retractions_when_ec", is_BBL_multi_extruder, variant_index);
    // Tab.cpp:4997
    bool long_retract_ec = config.has("long_retractions_when_ec") && config.opt_bool("long_retractions_when_ec", variant_index);
    toggle_line("retraction_distances_when_ec", is_BBL_multi_extruder && long_retract_ec, variant_index);
}

// Tab.cpp:9168
void toggle_sla_material_options(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    auto toggle_field = [&](const std::string& opt_key, bool toggle, int opt_index = -1) {
        std::string k = (opt_index >= 0) ? (opt_key + "#" + std::to_string(opt_index)) : opt_key;
        result.fields[k].enabled = toggle;
    };
    // Tab.cpp:9172
    std::string model = !context.printer_model.empty() ? context.printer_model : (config.has("printer_model") ? config.opt_string("printer_model") : "");
    toggle_field("material_print_speed", model != "SL1");
}

void check_filament_rules(const DynamicPrintConfig& config, const RuleContext& context, RuleResult& result)
{
    check_nozzle_recommended_temperature_range(config, context, result);
    check_nozzle_temperature_range(config, context, result);
    check_nozzle_temperature_initial_layer_range(config, context, result);
    check_adaptive_pressure_advance_model(config, context, result);
    check_filament_max_volumetric_speed(config, context, result);
    check_filament_ironing_spacing(config, context, result);
    check_chamber_temperature(config, context, result);
    check_chamber_minimal_temperature(config, context, result);
}

RuleResult evaluate_print_rules(const DynamicPrintConfig& full_config, const RuleContext& context)
{
    RuleResult result;
    update_print_fff_config(full_config, context, result);
    toggle_print_fff_options(full_config, context, result);
    return result;
}

RuleResult evaluate_printer_rules(const DynamicPrintConfig& full_config, const RuleContext& context)
{
    RuleResult result;
    check_layer_height(full_config, context, result);
    toggle_printer_options(full_config, context, result);
    return result;
}

RuleResult evaluate_filament_rules(const DynamicPrintConfig& full_config, const RuleContext& context)
{
    RuleResult result;
    check_filament_rules(full_config, context, result);
    toggle_filament_options(full_config, context, result);
    return result;
}

RuleResult evaluate_sla_print_rules(const DynamicPrintConfig& full_config, const RuleContext& context)
{
    RuleResult result;
    update_print_sla_config(full_config, context, result);
    toggle_print_sla_options(full_config, context, result);
    return result;
}

RuleResult evaluate_sla_material_rules(const DynamicPrintConfig& full_config, const RuleContext& context)
{
    RuleResult result;
    toggle_sla_material_options(full_config, context, result);
    return result;
}

} // namespace OrcaWeb
