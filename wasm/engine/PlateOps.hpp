#pragma once

#include <nlohmann/json.hpp>
#include <vector>
#include <string>

#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"

namespace OrcaEngine {

// Column count for grid layout matching desktop PartPlate.hpp
int computeColumnCount(size_t count);

// Plate stride calculation
void getPlateStride(double bed_width, double bed_depth, double& stride_x, double& stride_y);

// Bed dimensions from printable_area / printable_height
void getBedDimensions(const Slic3r::DynamicPrintConfig& config, double& width, double& depth, double& height);

// Compute world origin for plate index in grid layout
Slic3r::Vec3d computePlateOrigin(int index, size_t total_plates, double bed_width, double bed_depth);

// Assign model instances to plates based on spatial bounding box intersection
void assignInstancesToPlates(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config
);

// Wipe tower per-plate placement matching desktop PartPlate.cpp
void updateWipeTowerPosition(
    Slic3r::DynamicPrintConfig& config,
    Slic3r::Model& model,
    const Slic3r::PlateDataPtrs& plates,
    int plate_idx = -1
);

// Engine operations
nlohmann::json listPlates(
    const Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config
);

nlohmann::json addPlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
);

nlohmann::json duplicatePlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
);

nlohmann::json deletePlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
);

nlohmann::json setPlateConfig(
    const nlohmann::json& args,
    Slic3r::PlateDataPtrs& plates
);

} // namespace OrcaEngine
