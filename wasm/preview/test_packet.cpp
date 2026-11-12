#include "packet.hpp"
#include <cassert>
#include <cstdio>
#include <iterator>
int main() {
    PreviewPacket p;
    p.data.vertices.emplace_back();
    p.data.tools_colors.push_back({1, 2, 3, 4});
    p.data.color_print_colors = p.data.tools_colors;
    p.data.spiral_vase_mode = true;
    p.stats = R"({"layers":1,"moves":1,"timeS":0,"filamentMm":0,"filamentG":0,"features":[]})";
    p.bed = {{1,2},{3,4},{5,6}};
    const char* path = "/tmp/orca-preview-packet-test.bin";
    save_packet(path, p);
    auto copy = read_packet(path);
    assert(copy.stats == p.stats && copy.data.vertices.size() == 1);
    assert(copy.data.tools_colors == p.data.tools_colors && copy.data.spiral_vase_mode);
    assert(copy.bed == p.bed);
    std::ifstream valid(path, std::ios::binary);
    std::string bytes((std::istreambuf_iterator<char>(valid)), {});
    valid.close();
    for (size_t n = 0; n < bytes.size(); ++n) {
        { std::ofstream out(path, std::ios::binary); out.write(bytes.data(), n); }
        bool failed = false;
        try { read_packet(path); } catch (const std::exception&) { failed = true; }
        assert(failed);
    }
    { std::ofstream out(path, std::ios::binary); out << "bad"; }
    bool rejected = false;
    try { read_packet(path); } catch (const std::exception&) { rejected = true; }
    assert(rejected);
    const auto rejects = [&](PreviewPacket invalid) {
        save_packet(path, invalid);
        bool failed = false;
        try { read_packet(path); } catch (const std::exception&) { failed = true; }
        assert(failed);
    };
    auto invalid = p; invalid.data.tools_colors.clear(); rejects(invalid);
    invalid = p; invalid.data.color_print_colors.clear(); rejects(invalid);
    invalid = p; invalid.data.vertices[0].extruder_id = 255; rejects(invalid);
    invalid = p; invalid.stats = "{invalid}"; rejects(invalid);
    invalid = p; invalid.stats = R"({"layers":"bad"})"; rejects(invalid);
    invalid = p; invalid.bed[0].first = NAN; rejects(invalid);
    invalid = p; invalid.data.vertices[0].width = NAN; rejects(invalid);
    std::remove(path);
}
