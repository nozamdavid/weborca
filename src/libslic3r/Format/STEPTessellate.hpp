#ifndef slic3r_Format_STEPTessellate_hpp_
#define slic3r_Format_STEPTessellate_hpp_

#include <cstdint>
#include <string>
#include <vector>

// OCCT-only half of the STEP importer. Nothing in this header depends on OCCT,
// Slic3r::Model or TriangleMesh, so it can be compiled into a standalone
// Emscripten module (wasm/step) that tessellates a STEP file without the engine.

namespace Slic3r {

// One named solid, tessellated. `positions` holds xyz triples in face/node
// order exactly as the OCCT triangulations produced them (per-face location
// applied); `indices` holds three vertex indices per triangle.
struct StepMesh
{
    std::string           name;
    std::vector<float>    positions;
    std::vector<uint32_t> indices;
};

// Parses `path`, collects the named solids the same way Step::load() does and
// tessellates them in solid order. Solids without triangulation and without
// triangles are skipped. Returns false and fills `error` on failure.
bool step_tessellate(const std::string&       path,
                     double                   linear_deflection,
                     double                   angle_deflection,
                     bool                     split_compound,
                     std::vector<StepMesh>&   out,
                     std::string&             error);

#ifndef SLIC3R_NO_OCCT
struct NamedSolid;

// Tessellates one solid into `out` (name, positions, indices). `in_parallel`
// is forwarded to BRepMesh_IncrementalMesh. Throws OCCT exceptions; the desktop
// importer calls it from its tbb::parallel_for over the solids.
void step_tessellate_solid(const NamedSolid& solid,
                           double            linear_deflection,
                           double            angle_deflection,
                           bool              in_parallel,
                           StepMesh&         out);

// Serial tessellation of solids already collected by Step::load(), so the
// importer does not parse the file twice. Defined in STEPTessellate.cpp.
bool step_tessellate(const std::vector<NamedSolid>& solids,
                     double                        linear_deflection,
                     double                        angle_deflection,
                     std::vector<StepMesh>&        out,
                     std::string&                  error);
#endif

} // namespace Slic3r

#endif /* slic3r_Format_STEPTessellate_hpp_ */
