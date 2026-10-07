#pragma once

#include "libslic3r/Config.hpp"
#include "libslic3r/PrintConfig.hpp"
#include <map>
#include <string>
#include <vector>

namespace OrcaWeb {

/// Represents the UI state of a configuration field/option.
/// toggle_field in desktop sets enabled (disabled vs enabled).
/// toggle_line in desktop sets visible (hidden vs shown).
struct FieldState {
    bool enabled = true;
    bool visible = true;
    std::string label = "";
};

/// Represents a proposed or automatic fix to a configuration key.
/// Reason contains the explanation or desktop dialog question and answer.
struct Fix {
    std::string key;
    std::string value;
    std::string reason;
};

/// Aggregated result of evaluating configuration rules.
struct RuleResult {
    std::map<std::string, FieldState> fields;
    std::vector<Fix> fixes;
    std::vector<std::string> messages;
};

/// Context parameters replacing desktop GUI-only state (wxGetApp(), preset bundle, plater, app_config).
struct RuleContext {
    // Printer hardware/model capabilities
    bool is_bbl_printer = false;
    bool support_wrapping_detection = false;
    bool support_chamber_temp_control = false;
    bool machine_supports_junction_deviation = false;
    bool single_extruder_multi_material = false;
    bool supports_wipe_tower_2 = false;
    bool purge_in_prime_tower = false;
    bool support_parallel_printheads = false;
    bool support_multi_bed_types = false;
    std::string printer_model = "";

    // Extruders & filaments
    int filament_cnt = 1;
    int extruders_count = 1;
    int curr_bed_type = -1; // BedType enum or -1 if unspecified
    std::vector<bool> is_mixed_filament;

    // Layer height limits (from printer extruder profile)
    double min_layer_height = 0.0;
    double max_layer_height = 0.0;

    // Evaluation scope
    int variant_index = 0; // Extruder/variant index (0..n)
    bool is_global_config = true;
    bool is_plate_config = false;

    // Project / model state
    bool has_variable_layer_height = false;
    bool no_warn_mixed_sublayer_variable_layer = false;
};

// High-level rule evaluation entry points
RuleResult evaluate_print_rules(const Slic3r::DynamicPrintConfig& full_config, const RuleContext& context = {});
RuleResult evaluate_printer_rules(const Slic3r::DynamicPrintConfig& full_config, const RuleContext& context = {});
RuleResult evaluate_filament_rules(const Slic3r::DynamicPrintConfig& full_config, const RuleContext& context = {});
RuleResult evaluate_sla_print_rules(const Slic3r::DynamicPrintConfig& full_config, const RuleContext& context = {});
RuleResult evaluate_sla_material_rules(const Slic3r::DynamicPrintConfig& full_config, const RuleContext& context = {});

// Individual rule evaluation functions (matching ConfigManipulation.cpp)
void update_print_fff_config(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void toggle_print_fff_options(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);

void check_layer_height(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);

void check_filament_rules(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_nozzle_recommended_temperature_range(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_nozzle_temperature_range(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_nozzle_temperature_initial_layer_range(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_adaptive_pressure_advance_model(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_filament_max_volumetric_speed(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_filament_ironing_spacing(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_chamber_temperature(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void check_chamber_minimal_temperature(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);

void update_print_sla_config(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void toggle_print_sla_options(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);

// Tab.cpp rule evaluation functions
void toggle_printer_options(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void toggle_filament_options(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);
void toggle_sla_material_options(const Slic3r::DynamicPrintConfig& config, const RuleContext& context, RuleResult& result);

} // namespace OrcaWeb
