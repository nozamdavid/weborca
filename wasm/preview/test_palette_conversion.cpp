#include "convert.hpp"

#include <cassert>
#include <iostream>

int main()
{
    using libvgcode::ColorWithAlpha;
    const auto check = [](const std::string& encoded, const ColorWithAlpha& expected) {
        assert(libvgcode::convert(encoded) == expected);
    };
    check("#000000", { 0, 0, 0, 255 });
    check("#ff0000", { 255, 0, 0, 255 });
    check("#00ff00", { 0, 255, 0, 255 });
    check("#0000ff", { 0, 0, 255, 255 });
    check("#12345600", { 18, 52, 86, 0 });
    check("#12345680", { 18, 52, 86, 128 });
    check("#123456ff", { 18, 52, 86, 255 });
    const ColorWithAlpha fallback{ libvgcode::DUMMY_COLOR[0], libvgcode::DUMMY_COLOR[1],
        libvgcode::DUMMY_COLOR[2], 255 };
    check("invalid", fallback);
    check("", fallback);
    assert((libvgcode::convert(Slic3r::ColorRGBA{ 0.0f, 0.5f, 1.0f, 0.5f }) ==
        ColorWithAlpha{ 0, 128, 255, 128 }));
    const auto rgb = libvgcode::convert(libvgcode::Color{ 0, 128, 255 });
    assert(rgb.r() == 0.0f && rgb.b() == 1.0f && rgb.a() == 1.0f);
    std::cout << "Preview palette conversion passed\n";
}
