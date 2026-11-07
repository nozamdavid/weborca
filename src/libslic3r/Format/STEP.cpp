#include "../Model.hpp"
#include "../TriangleMesh.hpp"
#include "libslic3r/Exception.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Thread.hpp"

#include "STEP.hpp"
#include "STEPTessellate.hpp"

#include <boost/filesystem/path.hpp>
#include <ios>
#include <ostream>
#include <cstddef>
#ifndef SLIC3R_NO_OCCT
#include <Standard_Failure.hxx>
#include <Standard_Handle.hxx>
#include <Standard_TypeDef.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <atomic>
#include <exception>
#include <IFSelect_ReturnStatus.hxx>
#include <boost/chrono/duration.hpp>
#include <cstring>
#include <Poly_Triangulation.hxx>
#include <cstdint>
#include <gp_Trsf.hxx>
#include <gp_Pnt.hxx>
#include <TopAbs_Orientation.hxx>
#include <Poly_Triangle.hxx>
#endif
#include <string>
#include <boost/nowide/cstdio.hpp>
#include <boost/nowide/iostream.hpp>
#include <boost/nowide/fstream.hpp>

#include <tbb/blocked_range.h>
#include <tbb/parallel_for.h>
#include <vector>
#include <utility>

#ifndef SLIC3R_NO_OCCT
#ifdef _WIN32
#define DIR_SEPARATOR '\\'
#else
#define DIR_SEPARATOR '/'
#endif

#include "STEPCAFControl_Reader.hxx"
#include "BRepMesh_IncrementalMesh.hxx"
#include "Interface_Static.hxx"
#include "XCAFDoc_DocumentTool.hxx"
#include "XCAFDoc_ShapeTool.hxx"
#include "XCAFApp_Application.hxx"
#include "NCollection_Sequence.hxx"
#include "TDF_Label.hxx"
#include "TopoDS_Solid.hxx"
#include "TopoDS_Compound.hxx"
#include "TopoDS_Builder.hxx"
#include "TopoDS.hxx"
#include "TDataStd_Name.hxx"
#include "BRepBuilderAPI_Transform.hxx"
#include "TopExp_Explorer.hxx"
#include "TopExp_Explorer.hxx"
#include "BRep_Tool.hxx"
#include "BRepTools.hxx"
#include <IMeshTools_Parameters.hxx>
#endif

namespace fs = boost::filesystem;


namespace Slic3r {

TriangleMesh step_indexed_to_triangle_mesh(const float* positions, const uint32_t* indices, size_t triangle_count)
{
    stl_file stl;
    stl.stats.type = inmemory;
    stl.stats.number_of_facets = uint32_t(triangle_count);
    stl.stats.original_num_facets = stl.stats.number_of_facets;
    stl_allocate(&stl);
    for (size_t facet_idx = 0; facet_idx < triangle_count; ++facet_idx) {
        stl_facet facet;
        for (int corner = 0; corner < 3; ++corner) {
            const uint32_t vertex_idx = indices[facet_idx * 3 + corner];
            facet.vertex[corner] = Vec3f(positions[vertex_idx * 3],
                                         positions[vertex_idx * 3 + 1],
                                         positions[vertex_idx * 3 + 2]);
        }
        facet.extra[0] = 0;
        facet.extra[1] = 0;
        stl_normal normal;
        stl_calculate_normal(normal, &facet);
        stl_normalize_vector(normal);
        facet.normal = normal;
        stl.facet_start[facet_idx] = facet;
    }
    TriangleMesh triangle_mesh;
    triangle_mesh.from_stl(stl);
    return triangle_mesh;
}

#ifndef SLIC3R_NO_OCCT

//bool load_step(const char *path, Model *model, bool& is_cancel,
//               double linear_deflection/*=0.003*/,
//               double angle_deflection/*= 0.5*/,
//               bool isSplitCompound,
//               ImportStepProgressFn stepFn, StepIsUtf8Fn isUtf8Fn, long& mesh_face_num)
//{
//    bool cb_cancel = false;
//    if (stepFn) {
//        stepFn(LOAD_STEP_STAGE_READ_FILE, 0, 1, cb_cancel);
//        is_cancel = cb_cancel;
//        if (cb_cancel) {
//            return false;
//        }
//    }
//
//    if (!StepPreProcessor::isUtf8File(path) && isUtf8Fn)
//        isUtf8Fn(false);
//    std::string file_after_preprocess = std::string(path);
//
//    std::vector<NamedSolid> namedSolids;
//    Handle(TDocStd_Document) document;
//    Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
//    application->NewDocument(file_after_preprocess.c_str(), document);
//    STEPCAFControl_Reader reader;
//    reader.SetNameMode(true);
//    //BBS: Todo, read file is slow which cause the progress_bar no update and gui no response
//    IFSelect_ReturnStatus stat = reader.ReadFile(file_after_preprocess.c_str());
//    if (stat != IFSelect_RetDone || !reader.Transfer(document)) {
//        application->Close(document);
//        throw std::logic_error{ std::string{"Could not read '"} + path + "'" };
//        return false;
//    }
//    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(document->Main());
//    TDF_LabelSequence topLevelShapes;
//    shapeTool->GetFreeShapes(topLevelShapes);
//
//    unsigned int id{1};
//    Standard_Integer topShapeLength = topLevelShapes.Length() + 1;
//    auto stage_unit2 = topShapeLength / LOAD_STEP_STAGE_UNIT_NUM + 1;
//
//    for (Standard_Integer iLabel = 1; iLabel < topShapeLength; ++iLabel) {
//        if (stepFn) {
//            if ((iLabel % stage_unit2) == 0) {
//                stepFn(LOAD_STEP_STAGE_GET_SOLID, iLabel, topShapeLength, cb_cancel);
//                is_cancel = cb_cancel;
//            }
//            if (cb_cancel) {
//                shapeTool.reset(nullptr);
//                application->Close(document);
//                return false;
//            }
//        }
//        getNamedSolids(TopLoc_Location{}, "", id, shapeTool, topLevelShapes.Value(iLabel), namedSolids, isSplitCompound);
//    }
//
//    std::vector<stl_file> stl;
//    stl.resize(namedSolids.size());
//    tbb::parallel_for(tbb::blocked_range<size_t>(0, namedSolids.size()), [&](const tbb::blocked_range<size_t> &range) {
//        for (size_t i = range.begin(); i < range.end(); i++) {
//            BRepMesh_IncrementalMesh mesh(namedSolids[i].solid, linear_deflection, false, angle_deflection, true);
//            // BBS: calculate total number of the nodes and triangles
//            int aNbNodes     = 0;
//            int aNbTriangles = 0;
//            for (TopExp_Explorer anExpSF(namedSolids[i].solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
//                TopLoc_Location aLoc;
//                Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(anExpSF.Current()), aLoc);
//                if (!aTriangulation.IsNull()) {
//                    aNbNodes += aTriangulation->NbNodes();
//                    aNbTriangles += aTriangulation->NbTriangles();
//                }
//            }
//
//            if (aNbTriangles == 0 || aNbNodes == 0)
//                // BBS: No triangulation on the shape.
//                continue;
//
//            stl[i].stats.type                = inmemory;
//            stl[i].stats.number_of_facets    = (uint32_t) aNbTriangles;
//            stl[i].stats.original_num_facets = stl[i].stats.number_of_facets;
//            stl_allocate(&stl[i]);
//
//            std::vector<Vec3f> points;
//            points.reserve(aNbNodes);
//            // BBS: count faces missing triangulation
//            Standard_Integer aNbFacesNoTri = 0;
//            // BBS: fill temporary triangulation
//            Standard_Integer aNodeOffset    = 0;
//            Standard_Integer aTriangleOffet = 0;
//            for (TopExp_Explorer anExpSF(namedSolids[i].solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
//                const TopoDS_Shape &aFace = anExpSF.Current();
//                TopLoc_Location     aLoc;
//                Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(aFace), aLoc);
//                if (aTriangulation.IsNull()) {
//                    ++aNbFacesNoTri;
//                    continue;
//                }
//                // BBS: copy nodes
//                gp_Trsf aTrsf = aLoc.Transformation();
//                for (Standard_Integer aNodeIter = 1; aNodeIter <= aTriangulation->NbNodes(); ++aNodeIter) {
//                    gp_Pnt aPnt = aTriangulation->Node(aNodeIter);
//                    aPnt.Transform(aTrsf);
//                    points.emplace_back(std::move(Vec3f(aPnt.X(), aPnt.Y(), aPnt.Z())));
//                }
//                // BBS: copy triangles
//                const TopAbs_Orientation anOrientation = anExpSF.Current().Orientation();
//                Standard_Integer anId[3] = {};
//                for (Standard_Integer aTriIter = 1; aTriIter <= aTriangulation->NbTriangles(); ++aTriIter) {
//                    Poly_Triangle aTri = aTriangulation->Triangle(aTriIter);
//
//                    aTri.Get(anId[0], anId[1], anId[2]);
//                    if (anOrientation == TopAbs_REVERSED)
//                        std::swap(anId[1], anId[2]);
//                    // BBS: save triangles facets
//                    stl_facet facet;
//                    facet.vertex[0] = points[anId[0] + aNodeOffset - 1].cast<float>();
//                    facet.vertex[1] = points[anId[1] + aNodeOffset - 1].cast<float>();
//                    facet.vertex[2] = points[anId[2] + aNodeOffset - 1].cast<float>();
//                    facet.extra[0]  = 0;
//                    facet.extra[1]  = 0;
//                    stl_normal normal;
//                    stl_calculate_normal(normal, &facet);
//                    stl_normalize_vector(normal);
//                    facet.normal                                      = normal;
//                    stl[i].facet_start[aTriangleOffet + aTriIter - 1] = facet;
//                }
//
//                aNodeOffset += aTriangulation->NbNodes();
//                aTriangleOffet += aTriangulation->NbTriangles();
//            }
//        }
//    });
//
//    if (mesh_face_num != -1) {
//        for (size_t i = 0; i < stl.size(); i++) {
//            // Test for overflow
//            mesh_face_num += stl[i].stats.number_of_facets;
//        }
//        return true;
//    }
//
//    ModelObject *new_object = model->add_object();
//    const char * last_slash = strrchr(path, DIR_SEPARATOR);
//    new_object->name.assign((last_slash == nullptr) ? path : last_slash + 1);
//    new_object->input_file = path;
//
//    auto stage_unit3 = stl.size() / LOAD_STEP_STAGE_UNIT_NUM + 1;
//    for (size_t i = 0; i < stl.size(); i++) {
//        if (stepFn) {
//            if ((i % stage_unit3) == 0) {
//                stepFn(LOAD_STEP_STAGE_GET_MESH, i, stl.size(), cb_cancel);
//                is_cancel = cb_cancel;
//            }
//            if (cb_cancel) {
//                model->delete_object(new_object);
//                shapeTool.reset(nullptr);
//                application->Close(document);
//                return false;
//            }
//        }
//
//        //BBS: maybe mesh is empty from step file. Don't add
//        if (stl[i].stats.number_of_facets > 0) {
//            TriangleMesh triangle_mesh;
//            triangle_mesh.from_stl(stl[i]);
//            ModelVolume* new_volume = new_object->add_volume(std::move(triangle_mesh));
//            new_volume->name = namedSolids[i].name;
//            new_volume->source.input_file = path;
//            new_volume->source.object_idx = (int)model->objects.size() - 1;
//            new_volume->source.volume_idx = (int)new_object->volumes.size() - 1;
//        }
//    }
//
//    shapeTool.reset(nullptr);
//    application->Close(document);
//
//    //BBS: no valid shape from the step, delete the new object as well
//    if (new_object->volumes.size() == 0) {
//        model->delete_object(new_object);
//        return false;
//    }
//
//    return true;
//}

Step::Step(fs::path path, ImportStepProgressFn stepFn, StepIsUtf8Fn isUtf8Fn):
    m_stepFn(stepFn),
    m_utf8Fn(isUtf8Fn)
{
    m_path = path.string();
    m_app->NewDocument(TCollection_ExtendedString("BinXCAF"), m_doc);
}

Step::Step(std::string path, ImportStepProgressFn stepFn, StepIsUtf8Fn isUtf8Fn) :
    m_path(path),
    m_stepFn(stepFn),
    m_utf8Fn(isUtf8Fn)
{
    m_app->NewDocument(TCollection_ExtendedString("BinXCAF"), m_doc);
}

Step::~Step()
{
    m_app->Close(m_doc);
}

void Step::update_process(int load_stage, int current, int total, bool& cancel)
{
    if (m_stepFn) {
        m_stepFn(load_stage, current, total, cancel);
    }
}

Step::Step_Status Step::load()
{
    if (!StepPreProcessor::isUtf8File(m_path.c_str()) && m_utf8Fn) {
        m_utf8Fn(false);
        return Step_Status::LOAD_ERROR;
    }
    std::atomic<bool> stop_load_flag = false;
    Handle(StepProgressIncdicator) incdicator = new StepProgressIncdicator(stop_load_flag);
    bool task_result = false;
    bool cb_cancel = false;
    int progress = 0;
    bool load_result = false;
    auto task = new boost::thread(Slic3r::create_thread([&]() -> void {

        STEPCAFControl_Reader reader;
        reader.SetNameMode(true);
        IFSelect_ReturnStatus stat = reader.ReadFile(m_path.c_str());
        if (cb_cancel) return;
        progress = 3;
        if (stat != IFSelect_RetDone || !reader.Transfer(m_doc, incdicator->Start())) {
            load_result = false;
            task_result = true;
            return;
        }
        if (cb_cancel) return;
        progress = 6;
        m_shape_tool = XCAFDoc_DocumentTool::ShapeTool(m_doc->Main());
        NCollection_Sequence<TDF_Label> topLevelShapes;
        m_shape_tool->GetFreeShapes(topLevelShapes);
        unsigned int id{ 1 };
        int topShapeLength = topLevelShapes.Length() + 1;
        for (int iLabel = 1; iLabel < topShapeLength; ++iLabel) {
            if (cb_cancel) return;
            getNamedSolids(TopLoc_Location{}, "", id, m_shape_tool, topLevelShapes.Value(iLabel), m_name_solids);
        }
        progress = 10;
        load_result = true;
        task_result = true;
    }));
    while (!task_result) {
        boost::this_thread::sleep_for(boost::chrono::milliseconds(200));
        update_process(LOAD_STEP_STAGE_READ_FILE, progress, 10, cb_cancel);
        if (cb_cancel) {
            stop_load_flag.store(true);
            if (task) {
                if (task->joinable()) {
                    task->join();
                    delete task;
                }
            }
            return Step_Status::CANCEL;
        }
    }
    if (task){
        if (task->joinable()) {
            task->join();
            delete task;
        }
    }
    if (load_result) {
        return Step_Status::LOAD_SUCCESS;
    }else {
        return Step_Status::LOAD_ERROR;
    }
    
}

Step::Step_Status Step::mesh(Model* model,
                             bool& is_cancel,
                             bool isSplitCompound,
                             double linear_deflection/*=0.003*/,
                             double angle_deflection/*= 0.5*/)

{
    bool cb_cancel = false;
    std::atomic<bool> stop_flag{false}; // mirrors cb_cancel for the worker thread
    std::atomic<bool> task_result{false};
    std::atomic<bool> task_failed{false};
    std::atomic<float> progress{.0f};
    std::atomic<float> progress_2{.0f};
    std::atomic<int> meshed_solid_num{0};
    std::atomic<size_t> solid_num{0};
    ModelObject* new_object = model->add_object();
    const char* last_slash = strrchr(m_path.c_str(), DIR_SEPARATOR);
    new_object->name.assign((last_slash == nullptr) ? m_path.c_str() : last_slash + 1);
    new_object->input_file = m_path.c_str();

    // The XCAF document stays in this object; the solids are collected again
    // here because the split-compound option is only known at meshing time.
    auto mesh_task = [&]() -> void {
        try {
            std::vector<NamedSolid> namedSolids;
            NCollection_Sequence<TDF_Label> topLevelShapes;
            m_shape_tool->GetFreeShapes(topLevelShapes);
            unsigned int id{ 1 };
            int topShapeLength = topLevelShapes.Length() + 1;

            for (int iLabel = 1; iLabel < topShapeLength; ++iLabel) {
                progress = static_cast<float>(iLabel) / (topShapeLength-1);
                if (stop_flag)
                    return;
                getNamedSolids(TopLoc_Location{}, "", id, m_shape_tool, topLevelShapes.Value(iLabel), namedSolids, isSplitCompound);
            }
            solid_num = namedSolids.size();

            // OCCT parsing and tessellation live in STEPTessellate.cpp so the same
            // code can run in the standalone wasm STEP module.
            std::vector<StepMesh> meshes(namedSolids.size());
            auto mesh_solid = [&](size_t i) {
                if (stop_flag)
                    return;
                step_tessellate_solid(namedSolids[i], linear_deflection, angle_deflection, true, meshes[i]);
                meshed_solid_num.fetch_add(1, std::memory_order_relaxed);
            };
#ifdef __EMSCRIPTEN__
            // The wasm engine meshes serially, like the standalone STEP module.
            for (size_t i = 0; i < namedSolids.size(); ++i)
                mesh_solid(i);
#else
            tbb::parallel_for(tbb::blocked_range<size_t>(0, namedSolids.size()), [&](const tbb::blocked_range<size_t>& range) {
                for (size_t i = range.begin(); i < range.end(); i++)
                    mesh_solid(i);
            });
#endif

            for (size_t i = 0; i < meshes.size(); i++) {
                progress_2 = static_cast<float>(i) / meshes.size();
                if (stop_flag)
                    return;

                const StepMesh& solid = meshes[i];
                //BBS: maybe mesh is empty from step file. Don't add
                if (solid.indices.empty())
                    continue;
                TriangleMesh triangle_mesh = step_indexed_to_triangle_mesh(solid.positions.data(), solid.indices.data(),
                                                                           solid.indices.size() / 3);
                ModelVolume* new_volume = new_object->add_volume(std::move(triangle_mesh));
                new_volume->name = solid.name;
                new_volume->source.input_file = m_path.c_str();
                new_volume->source.object_idx = (int)model->objects.size() - 1;
                new_volume->source.volume_idx = (int)new_object->volumes.size() - 1;
            }
        } catch (const Standard_Failure&) {
            task_failed = true;
        } catch (const std::exception&) {
            task_failed = true;
        }
    };

#ifdef __EMSCRIPTEN__
    mesh_task();
    update_process(LOAD_STEP_STAGE_GET_MESH, 100, 100, cb_cancel);
#else
    auto task = new boost::thread(Slic3r::create_thread([&]() -> void {
        mesh_task();
        task_result = true;
    }));

    auto join_task = [&]() {
        if (task) {
            if (task->joinable()) {
                task->join();
                delete task;
            }
        }
    };

    while (!task_result) {
        boost::this_thread::sleep_for(boost::chrono::milliseconds(300));
        if (progress_2 > 0) {
            // third progress
            update_process(LOAD_STEP_STAGE_GET_MESH, static_cast<int>(progress_2 * 100), 100, cb_cancel);
        }else {
            if (meshed_solid_num.load()) {
                // second progress
                int meshed_solid = meshed_solid_num.load();
                update_process(LOAD_STEP_STAGE_GET_SOLID, static_cast<int>((float)meshed_solid / solid_num.load() * 10) + 10, 20, cb_cancel);
            } else {
                if (progress > 0) {
                    // first progress
                    update_process(LOAD_STEP_STAGE_GET_SOLID, static_cast<int>(progress * 10), 20, cb_cancel);
                }
            }
        }

        if (cb_cancel) {
            stop_flag = true;
            join_task();
            model->delete_object(new_object);
            is_cancel = true;
            return Step_Status::CANCEL;
        }
    }
    join_task();
#endif

    if (task_failed) {
        model->delete_object(new_object);
        return Step_Status::MESH_ERROR;
    }

    //BBS: no valid shape from the step, delete the new object as well
    if (new_object->volumes.size() == 0) {
        model->delete_object(new_object);
        return Step_Status::MESH_ERROR;
    }
    return Step_Status::MESH_SUCCESS;
}

void Step::clean_mesh_data()
{
    for (const auto& name_solid : m_name_solids) {
        BRepTools::Clean(name_solid.solid);
    }
}

unsigned int Step::get_triangle_num(double linear_deflection, double angle_deflection)
{
    unsigned int tri_num = 0;
    try {
        Handle(StepProgressIncdicator) progress = new StepProgressIncdicator(m_stop_mesh);
        clean_mesh_data();
        IMeshTools_Parameters param;
        param.Deflection = linear_deflection;
        param.Angle = angle_deflection;
        param.InParallel = true;
        for (int i = 0; i < m_name_solids.size(); ++i) {
            BRepMesh_IncrementalMesh mesh(m_name_solids[i].solid, param, progress->Start());
            for (TopExp_Explorer anExpSF(m_name_solids[i].solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
                TopLoc_Location aLoc;
                Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(anExpSF.Current()), aLoc);
                if (!aTriangulation.IsNull()) {
                    tri_num += aTriangulation->NbTriangles();
                }
            }
            if (m_stop_mesh.load()) {
                return 0;
            }
        }
    } catch(const Exception &) {
        return 0;
    }
    
    return tri_num;
}

unsigned int Step::get_triangle_num_tbb(double linear_deflection, double angle_deflection)
{
    unsigned int tri_num = 0;
    clean_mesh_data();
    tbb::parallel_for(tbb::blocked_range<size_t>(0, m_name_solids.size()),
    [&](const tbb::blocked_range<size_t>& range) {
        for (size_t i = range.begin(); i < range.end(); i++) {
            unsigned int solids_tri_num = 0;
            BRepMesh_IncrementalMesh mesh(m_name_solids[i].solid, linear_deflection, false, angle_deflection, true);
            for (TopExp_Explorer anExpSF(m_name_solids[i].solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
                TopLoc_Location aLoc;
                Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(anExpSF.Current()), aLoc);
                if (!aTriangulation.IsNull()) {
                    solids_tri_num += aTriangulation->NbTriangles();
                }
            }
            m_name_solids[i].tri_face_cout = solids_tri_num;
        }

    });
    for (int i = 0; i < m_name_solids.size(); ++i) {
        tri_num += m_name_solids[i].tri_face_cout;
    }
    return tri_num;
}

#else // SLIC3R_NO_OCCT

Step::Step(boost::filesystem::path path, ImportStepProgressFn stepFn, StepIsUtf8Fn isUtf8Fn)
    : m_path(path.string()), m_stepFn(stepFn), m_utf8Fn(isUtf8Fn) {}

Step::Step(std::string path, ImportStepProgressFn stepFn, StepIsUtf8Fn isUtf8Fn)
    : m_path(std::move(path)), m_stepFn(stepFn), m_utf8Fn(isUtf8Fn) {}

Step::~Step() = default;

Step::Step_Status Step::load()
{
    return Step_Status::LOAD_ERROR;
}

unsigned int Step::get_triangle_num(double /*linear_deflection*/, double /*angle_deflection*/)
{
    return 0;
}

unsigned int Step::get_triangle_num_tbb(double /*linear_deflection*/, double /*angle_deflection*/)
{
    return 0;
}

void Step::clean_mesh_data() {}

Step::Step_Status Step::mesh(Model* /*model*/, bool& /*is_cancel*/, bool /*isSplitCompound*/,
                             double /*linear_deflection*/, double /*angle_deflection*/)
{
    return Step_Status::LOAD_ERROR;
}

void Step::update_process(int /*load_stage*/, int /*current*/, int /*total*/, bool& /*cancel*/) {}

bool load_step(const char* /*path*/, Model* /*model*/,
               bool& /*is_cancel*/,
               double /*linear_deflection*/,
               double /*angle_deflection*/,
               bool /*isSplitCompound*/,
               ImportStepProgressFn /*proFn*/,
               StepIsUtf8Fn /*isUtf8Fn*/,
               long& /*mesh_face_num*/)
{
    return false;
}

#endif // SLIC3R_NO_OCCT
}; // namespace Slic3r
