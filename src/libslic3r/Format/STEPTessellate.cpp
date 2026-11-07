#include "STEPTessellate.hpp"
#include "STEP.hpp"

#include "libslic3r/Exception.hpp"

// Declared by libslic3r/Utils.hpp and used only by StepPreProcessor::preprocess().
// Utils.hpp drags in the generated version header and the rest of the platform
// layer, which the standalone STEP module does not link, so redeclare the two
// entry points instead of including it.
namespace Slic3r {
const std::string& temporary_dir();
std::string        decode_path(const char* src);
}

#ifndef SLIC3R_NO_OCCT
#include <Standard_Failure.hxx>
#include <Standard_Handle.hxx>
#include <Standard_TypeDef.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_Orientation.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <TopLoc_Location.hxx>
#include <TopAbs.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Shell.hxx>
#include <TDF_Label.hxx>
#include <TDataStd_Name.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <NCollection_Sequence.hxx>
#include <BRepTools.hxx>
#endif
#include <boost/nowide/cstdio.hpp>
#include <boost/nowide/fstream.hpp>

#include <cstdint>
#include <ostream>
#include <string>
#include <utility>
#include <vector>

namespace Slic3r {

// ---------------------------------------------------------------------------
// StepPreProcessor: identical behavior to the implementation that used to live
// in STEP.cpp. It is compiled into the standalone STEP module as well, so the
// UTF-8/GBK name handling travels with the tessellator.
// ---------------------------------------------------------------------------

bool StepPreProcessor::preprocess(const char* path, std::string &output_path)
{
    boost::nowide::ifstream infile(path);
    if (!infile.good()) {
        throw Slic3r::RuntimeError(std::string("Load step file failed.\nCannot open file for reading.\n"));
        return false;
    }

    boost::filesystem::path temp_path(temporary_dir());
    std::string temp_step_path = temp_path.string() + "/temp.step";
    boost::nowide::remove(temp_step_path.c_str());
    boost::nowide::ofstream temp_file(temp_step_path, std::ios::app);
    std::string temp_line;
    while (std::getline(infile, temp_line)) {
        if (m_encode_type == EncodedType::UTF8) {
            //BBS: continue to judge whether is other type
            if (isUtf8(temp_line)) {
                //BBS: do nothing, but must be checked before checking whether is GBK
            }
            //BBS: not utf8, then maybe GBK
            else if (isGBK(temp_line)) {
                m_encode_type = EncodedType::GBK;
            }
            //BBS: not UTF8 and not GBK, then maybe some kind of special encoded type which we can't handle
            // Load the step as UTF and user will see garbage characters in slicer but we have no solution at the moment
            else {
                m_encode_type = EncodedType::OTHER;
            }
        }
        if (m_encode_type == EncodedType::GBK)
            //BBS: transform to UTF8 format if is GBK
            //todo: use gbkToUtf8 function to replace
            temp_file << decode_path(temp_line.c_str()) << std::endl;
        else
            temp_file << temp_line.c_str() << std::endl;
    }
    temp_file.close();
    infile.close();
    if (m_encode_type == EncodedType::GBK) {
        output_path = temp_step_path;
    } else {
        boost::nowide::remove(temp_step_path.c_str());
        output_path = std::string(path);
    }

    return true;
}

bool StepPreProcessor::isUtf8File(const char* path)
{
    boost::nowide::ifstream infile(path);
    if (!infile.good()) {
        throw Slic3r::RuntimeError(std::string("Load step file failed.\nCannot open file for reading.\n"));
        return false;
    }

    std::string temp_line;
    while (std::getline(infile, temp_line)) {
        if (!isUtf8(temp_line)) {
            infile.close();
            return false;
        }
    }

    infile.close();
    return true;
}

bool StepPreProcessor::isUtf8(const std::string str)
{
    size_t num = 0;
    size_t i = 0;
    while (i < str.length()) {
        const unsigned char lead = static_cast<unsigned char>(str[i]);
        if ((lead & 0x80) == 0x00) {
            i++;
        // preNum() counts the leading 1 bits, and a multi-byte sequence is 2 to 4
        // bytes long, so anything outside that range is not a lead byte.
        } else if ((num = preNum(lead)) >= 2 && num <= 4) {
            if (i + num > str.length())
                return false;
            i++;
            for (size_t j = 0; j < num - 1; j++) {
                if ((static_cast<unsigned char>(str[i]) & 0xc0) != 0x80)
                    return false;
                i++;
            }
        } else {
            return false;
        }
    }
    return true;
}

bool StepPreProcessor::isGBK(const std::string str) {
    size_t i = 0;
    while (i < str.length()) {
        // char is signed here, so every byte compares <= 0x7f unless widened first.
        const unsigned char lead = static_cast<unsigned char>(str[i]);
        if (lead <= 0x7f) {
            i++;
            continue;
        } else {
            if (i + 1 >= str.length())
                return false;
            const unsigned char trail = static_cast<unsigned char>(str[i + 1]);
            if (lead >= 0x81 &&
                lead <= 0xfe &&
                trail >= 0x40 &&
                trail <= 0xfe &&
                trail != 0xf7) {
                i += 2;
                continue;
            }
            else {
                return false;
            }
        }
    }
    return true;
}

int StepPreProcessor::preNum(const unsigned char byte) {
    unsigned char mask = 0x80;
    int num = 0;
    for (int i = 0; i < 8; i++) {
        if ((byte & mask) == mask) {
            mask = mask >> 1;
            num++;
        } else {
            break;
        }
    }
    return num;
}

// ---------------------------------------------------------------------------
// XCAF solid collection (moved verbatim from STEP.cpp)
// ---------------------------------------------------------------------------

#ifndef SLIC3R_NO_OCCT
void getNamedSolids(const TopLoc_Location& location,
                    const std::string& prefix,
                    unsigned int& id,
                    const Handle(XCAFDoc_ShapeTool) shapeTool,
                    const TDF_Label label,
                    std::vector<NamedSolid>& namedSolids,
                    bool isSplitCompound) {
    TDF_Label referredLabel{label};
    if (shapeTool->IsReference(label))
        shapeTool->GetReferredShape(label, referredLabel);

    std::string name;
    Handle(TDataStd_Name) shapeName;
    if (referredLabel.FindAttribute(TDataStd_Name::GetID(), shapeName) ||
        label.FindAttribute(TDataStd_Name::GetID(), shapeName))
        name = TCollection_AsciiString(shapeName->Get()).ToCString();

    if (name == "" || !StepPreProcessor::isUtf8(name))
        name = std::to_string(id++);
    std::string fullName{name};

    TopLoc_Location localLocation = location * shapeTool->GetLocation(label);
    NCollection_Sequence<TDF_Label> components;
    if (shapeTool->GetComponents(referredLabel, components)) {
        for (int compIndex = 1; compIndex <= components.Length(); ++compIndex) {
            getNamedSolids(localLocation, fullName, id, shapeTool, components.Value(compIndex), namedSolids, isSplitCompound);
        }
    } else {
        TopoDS_Shape shape;
        TopExp_Explorer explorer;
        shapeTool->GetShape(referredLabel, shape);
        TopAbs_ShapeEnum shape_type = shape.ShapeType();
        BRepBuilderAPI_Transform transform(shape, localLocation, true);
        int                      i = 0;
        switch (shape_type) {
        case TopAbs_COMPOUND:
            if (!isSplitCompound) {
                namedSolids.emplace_back(TopoDS::Compound(transform.Shape()), fullName);
                break;
            }
        case TopAbs_COMPSOLID:
            if (!isSplitCompound) {
                namedSolids.emplace_back(TopoDS::CompSolid(transform.Shape()), fullName);
            } else {
                for (explorer.Init(transform.Shape(), TopAbs_SOLID); explorer.More(); explorer.Next()) {
                    i++;
                    const TopoDS_Shape& currentShape = explorer.Current();
                    namedSolids.emplace_back(TopoDS::Solid(currentShape), fullName + "-SOLID-" + std::to_string(i));
                }
            }
            break;
        case TopAbs_SOLID:
            namedSolids.emplace_back(TopoDS::Solid(transform.Shape()), fullName);
            break;
        case TopAbs_SHELL:
            namedSolids.emplace_back(TopoDS::Shell(transform.Shape()), fullName);
            break;
        default:
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Tessellation. This is the per-solid body that used to run inside the
// tbb::parallel_for in Step::mesh, emitting plain index/position arrays. The
// desktop importer still calls it from a parallel_for; the standalone module
// loops over it serially.
// ---------------------------------------------------------------------------

void step_tessellate_solid(const NamedSolid& named_solid,
                           double            linear_deflection,
                           double            angle_deflection,
                           bool              in_parallel,
                           StepMesh&         out) {
    BRepMesh_IncrementalMesh mesh(named_solid.solid, linear_deflection, false, angle_deflection, in_parallel);
    // BBS: calculate total number of the nodes and triangles
    int aNbNodes = 0;
    int aNbTriangles = 0;
    for (TopExp_Explorer anExpSF(named_solid.solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
        TopLoc_Location aLoc;
        Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(anExpSF.Current()), aLoc);
        if (!aTriangulation.IsNull()) {
            aNbNodes += aTriangulation->NbNodes();
            aNbTriangles += aTriangulation->NbTriangles();
        }
    }

    out.name = named_solid.name;
    out.positions.clear();
    out.indices.clear();
    if (aNbTriangles == 0 || aNbNodes == 0)
        // BBS: No triangulation on the shape.
        return;

    out.positions.reserve(size_t(aNbNodes) * 3);
    out.indices.reserve(size_t(aNbTriangles) * 3);

    int aNodeOffset = 0;
    for (TopExp_Explorer anExpSF(named_solid.solid, TopAbs_FACE); anExpSF.More(); anExpSF.Next()) {
        TopLoc_Location aLoc;
        Handle(Poly_Triangulation) aTriangulation = BRep_Tool::Triangulation(TopoDS::Face(anExpSF.Current()), aLoc);
        if (aTriangulation.IsNull())
            continue;
        // BBS: copy nodes
        gp_Trsf aTrsf = aLoc.Transformation();
        for (int aNodeIter = 1; aNodeIter <= aTriangulation->NbNodes(); ++aNodeIter) {
            gp_Pnt aPnt = aTriangulation->Node(aNodeIter);
            aPnt.Transform(aTrsf);
            out.positions.push_back(float(aPnt.X()));
            out.positions.push_back(float(aPnt.Y()));
            out.positions.push_back(float(aPnt.Z()));
        }
        // BBS: copy triangles
        const TopAbs_Orientation anOrientation = anExpSF.Current().Orientation();
        int anId[3] = {};
        for (int aTriIter = 1; aTriIter <= aTriangulation->NbTriangles(); ++aTriIter) {
            Poly_Triangle aTri = aTriangulation->Triangle(aTriIter);
            aTri.Get(anId[0], anId[1], anId[2]);
            if (anOrientation == TopAbs_REVERSED)
                std::swap(anId[1], anId[2]);
            out.indices.push_back(uint32_t(anId[0] + aNodeOffset - 1));
            out.indices.push_back(uint32_t(anId[1] + aNodeOffset - 1));
            out.indices.push_back(uint32_t(anId[2] + aNodeOffset - 1));
        }
        aNodeOffset += aTriangulation->NbNodes();
    }
}

bool step_tessellate(const std::vector<NamedSolid>& solids,
                     double                        linear_deflection,
                     double                        angle_deflection,
                     std::vector<StepMesh>&        out,
                     std::string&                  error) {
    out.clear();
    error.clear();
    out.reserve(solids.size());
    try {
        // Serial on purpose: the standalone module does not bring up a TBB or
        // pthread pool, and the per-solid loop is the only parallel part.
        for (const NamedSolid& named_solid : solids) {
            StepMesh mesh;
            step_tessellate_solid(named_solid, linear_deflection, angle_deflection, false, mesh);
            if (mesh.indices.empty())
                continue;
            out.push_back(std::move(mesh));
        }
    } catch (const Standard_Failure& failure) {
        error = failure.what() ? failure.what() : "OCCT failure while tessellating STEP";
        out.clear();
        return false;
    } catch (const std::exception& ex) {
        error = ex.what();
        out.clear();
        return false;
    }
    return true;
}

bool step_tessellate(const std::string&     path,
                     double                 linear_deflection,
                     double                 angle_deflection,
                     bool                   split_compound,
                     std::vector<StepMesh>& out,
                     std::string&           error) {
    out.clear();
    error.clear();
    try {
        // A standalone document: XCAFApp_Application would register every XCAF driver and link the
        // visualisation toolkits (V3d, HLR, Service, VCAF) into the wasm module for nothing.
        Handle(TDocStd_Document) document = new TDocStd_Document(TCollection_ExtendedString("BinXCAF"));
        XCAFDoc_DocumentTool::Set(document->Main());

        STEPCAFControl_Reader reader;
        reader.SetNameMode(true);
        IFSelect_ReturnStatus stat = reader.ReadFile(path.c_str());
        if (stat != IFSelect_RetDone || !reader.Transfer(document)) {
            error = "Failed to read STEP file: " + path;
            return false;
        }

        Handle(XCAFDoc_ShapeTool) shape_tool = XCAFDoc_DocumentTool::ShapeTool(document->Main());
        NCollection_Sequence<TDF_Label> top_level_shapes;
        shape_tool->GetFreeShapes(top_level_shapes);
        std::vector<NamedSolid> named_solids;
        unsigned int id = 1;
        const int top_shape_length = top_level_shapes.Length() + 1;
        for (int iLabel = 1; iLabel < top_shape_length; ++iLabel)
            getNamedSolids(TopLoc_Location{}, "", id, shape_tool, top_level_shapes.Value(iLabel), named_solids, split_compound);

        const bool result = step_tessellate(named_solids, linear_deflection, angle_deflection, out, error);
        for (const NamedSolid& named_solid : named_solids)
            BRepTools::Clean(named_solid.solid);
        return result;
    } catch (const Standard_Failure& failure) {
        error = failure.what() ? failure.what() : "OCCT failure while reading STEP";
        out.clear();
        return false;
    } catch (const std::exception& ex) {
        error = ex.what();
        out.clear();
        return false;
    }
}

#else // SLIC3R_NO_OCCT

bool step_tessellate(const std::string& /*path*/,
                     double /*linear_deflection*/,
                     double /*angle_deflection*/,
                     bool /*split_compound*/,
                     std::vector<StepMesh>& out,
                     std::string& error) {
    out.clear();
    error = "STEP format is not supported in this build (OCCT disabled)";
    return false;
}

#endif // SLIC3R_NO_OCCT

} // namespace Slic3r
