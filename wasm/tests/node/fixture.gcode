G21 ; set units to millimeters
G90 ; use absolute coordinates
M83 ; extruder relative mode
M104 S210 ; set nozzle temp
M109 S210 ; wait for nozzle temp
M106 S255 ; set fan to 100%
M900 K0.08 ; set PA

G1 Z0.2 F3000

; FEATURE: Skirt
G1 X10 Y10 E1.0 F1500

; FEATURE: Outer wall
G1 X20 Y10 E1.2 F1200

; FEATURE: Inner wall
G1 X20 Y20 E1.4 F2400

; FEATURE: Sparse infill
G1 X10 Y20 E1.5 F3600

; FEATURE: Internal solid infill
G1 X10 Y10 E1.3 F1800
