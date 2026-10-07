import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node extract_tab_layout.mjs <repoRoot> <out.json>');
  process.exit(1);
}

const repoRoot = path.resolve(args[0]);
const outJsonPath = path.resolve(args[1]);

const tabCppPath = path.join(repoRoot, 'src/slic3r/GUI/Tab.cpp');
const publishSettingsPath = path.join(repoRoot, 'src/libslic3r/PublishSettings.cpp');

if (!fs.existsSync(tabCppPath)) {
  console.error(`Error: Tab.cpp not found at ${tabCppPath}`);
  process.exit(1);
}

// 1. Get gitBlob hash for Tab.cpp
let gitBlob = '';
try {
  gitBlob = execSync(`git hash-object "${tabCppPath}"`, { encoding: 'utf8' }).trim();
} catch (e) {
  gitBlob = 'unknown';
}

// 2. Parse PublishSettings.cpp for printer retraction and z-hop options
let printerRetractionOptions = [];
let printerZHopOptions = [];

if (fs.existsSync(publishSettingsPath)) {
  const pubContent = fs.readFileSync(publishSettingsPath, 'utf8');

  function parsePublishableVector(funcName) {
    const funcIdx = pubContent.indexOf(funcName);
    if (funcIdx === -1) return [];
    const optMarker = pubContent.indexOf('options = {', funcIdx);
    if (optMarker === -1) return [];
    const startBrace = pubContent.indexOf('{', optMarker);
    const endBrace = pubContent.indexOf('};', startBrace);
    if (startBrace === -1 || endBrace === -1) return [];
    const block = pubContent.substring(startBrace, endBrace);
    const entries = [];
    const re = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      entries.push({ key: m[1], helpLink: m[2] });
    }
    return entries;
  }

  printerRetractionOptions = parsePublishableVector('publishable_printer_retraction_options');
  printerZHopOptions = parsePublishableVector('publishable_printer_z_hop_options');
}

// 3. Parse Tab.cpp
const tabCppSource = fs.readFileSync(tabCppPath, 'utf8');
const allLines = tabCppSource.split('\n');

// Helper to find function start and end line (1-indexed)
function findFunctionRange(sourceLines, signatureRegex) {
  let startLine = -1;
  for (let i = 0; i < sourceLines.length; i++) {
    if (signatureRegex.test(sourceLines[i])) {
      startLine = i + 1;
      break;
    }
  }
  if (startLine === -1) return null;

  let depth = 0;
  let started = false;
  for (let i = startLine - 1; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '/' && line[j + 1] === '/') break;
      if (line[j] === '{') {
        depth++;
        started = true;
      } else if (line[j] === '}') {
        depth--;
        if (started && depth === 0) {
          return { start: startLine, end: i + 1 };
        }
      }
    }
  }
  return null;
}

// Consume matching braces starting from startLine (1-indexed)
function consumeMatchingBraces(startLine, maxLine) {
  let depth = 0;
  let started = false;
  for (let i = startLine - 1; i < maxLine; i++) {
    const line = allLines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '/' && line[j + 1] === '/') break;
      if (line[j] === '{') {
        depth++;
        started = true;
      } else if (line[j] === '}') {
        depth--;
        if (started && depth === 0) {
          return i + 1;
        }
      }
    }
  }
  return maxLine;
}

const unparsedList = [];

// Helper to clean quotes and wxString L(...) wrappers
function cleanStringLiteral(str) {
  if (!str) return '';
  str = str.trim();
  const m = str.match(/^(?:_?L?|_)\s*\(\s*(?:L)?"([\s\S]*)"\s*\)$/) || str.match(/^(?:L)?"([\s\S]*)"$/);
  if (m) return m[1];
  return str;
}

// Split C++ function arguments, respecting nested parentheses and string literals
function splitArgs(str) {
  const args = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuote) {
      current += c;
      if (c === quoteChar && str[i - 1] !== '\\') inQuote = false;
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
      current += c;
    } else if (c === '(' || c === '{') {
      depth++;
      current += c;
    } else if (c === ')' || c === '}') {
      depth--;
      current += c;
    } else if (c === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function parseKeyAndIndex(rawKey, rawIdx) {
  let key = rawKey;
  let index = undefined;

  if (key && key.includes('#')) {
    const parts = key.split('#');
    key = parts[0];
    const parsed = parseInt(parts[1], 10);
    if (!Number.isNaN(parsed)) index = parsed;
  }

  if (rawIdx !== undefined && rawIdx !== null) {
    if (typeof rawIdx === 'number') {
      index = rawIdx;
    } else if (typeof rawIdx === 'string') {
      const trimmed = rawIdx.trim();
      if (trimmed === 'extruder_idx') {
        index = 0;
      } else {
        const parsed = parseInt(trimmed, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          index = parsed;
        }
      }
    }
  }

  return { key, index };
}

// Function scanner
class TabScanner {
  constructor() {
    this.pages = [];
    this.currentPage = null;
    this.currentGroup = null;
    this.conditionBlocks = []; // { endLine, condition }
    this.optVars = new Map(); // varName -> { key, index, helpLink }
    this.currentLineBuilder = null;
    this.vectors = new Map(); // name -> string[]
  }

  getCurrentCondition(lineNum) {
    const active = this.conditionBlocks
      .filter(b => lineNum <= b.endLine)
      .map(b => b.condition);
    return active.length > 0 ? active.join(' && ') : undefined;
  }

  addPage(title, icon, condition) {
    const pageObj = {
      title,
      icon,
      groups: [],
    };
    if (condition) pageObj.condition = condition;
    this.pages.push(pageObj);
    this.currentPage = pageObj;
    this.currentGroup = null;
  }

  addGroup(title, anchor, condition) {
    if (!this.currentPage) {
      this.addPage('General', '', condition);
    }
    const groupObj = {
      title,
      anchor,
      lines: [],
    };
    if (condition) groupObj.condition = condition;
    this.currentPage.groups.push(groupObj);
    this.currentGroup = groupObj;
  }

  addLine(lineObj, condition) {
    if (!this.currentGroup) {
      this.addGroup('', '', condition);
    }
    if (condition) lineObj.condition = condition;
    this.currentGroup.lines.push(lineObj);
  }
}

// Function to scan lines of a function
function scanFunctionLines(scanner, startLine, endLine, helperFunctions = {}) {
  let lineNum = startLine;
  let inBlockComment = false;
  let inIf0 = false;
  let if0Depth = 0;

  while (lineNum <= endLine) {
    const rawLine = allLines[lineNum - 1];
    let trimmed = rawLine.trim();

    // Check preprocessor #if 0
    if (trimmed.startsWith('#if 0')) {
      inIf0 = true;
      if0Depth = 1;
      lineNum++;
      continue;
    }
    if (inIf0) {
      if (trimmed.startsWith('#if')) if0Depth++;
      else if (trimmed.startsWith('#endif')) {
        if0Depth--;
        if (if0Depth === 0) inIf0 = false;
      }
      lineNum++;
      continue;
    }

    // Ignore other preprocessor lines like #if 1, #else, #endif
    if (trimmed.startsWith('#')) {
      lineNum++;
      continue;
    }

    // Block comments
    if (inBlockComment) {
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        trimmed = trimmed.substring(trimmed.indexOf('*/') + 2).trim();
      } else {
        lineNum++;
        continue;
      }
    }
    if (trimmed.startsWith('/*')) {
      if (trimmed.includes('*/')) {
        trimmed = trimmed.substring(trimmed.indexOf('*/') + 2).trim();
      } else {
        inBlockComment = true;
        lineNum++;
        continue;
      }
    }

    // Remove single line comments
    const commentIdx = trimmed.indexOf('//');
    if (commentIdx !== -1) {
      trimmed = trimmed.substring(0, commentIdx).trim();
    }

    if (!trimmed) {
      lineNum++;
      continue;
    }
    if (trimmed === '{' || trimmed === '}' || trimmed === '};') {
      lineNum++;
      continue;
    }

    // Skip function declarations (e.g. void TabPrint::build())
    if (trimmed.match(/^(?:void|PageShp)\s+Tab\w+::\w+/)) {
      lineNum++;
      continue;
    }

    // Check helper calls (only invocations, not definitions)
    if (helperFunctions['add_filament_overrides_page'] && !trimmed.startsWith('void ') && trimmed.startsWith('add_filament_overrides_page(')) {
      const helperRange = helperFunctions['add_filament_overrides_page'];
      scanFunctionLines(scanner, helperRange.start, helperRange.end, {});
      lineNum++;
      continue;
    }
    if (helperFunctions['build_unregular_pages'] && !trimmed.startsWith('void ') && trimmed.startsWith('build_unregular_pages(')) {
      const helperRange = helperFunctions['build_unregular_pages'];
      const subHelpers = { build_kinematics_page: helperFunctions['build_kinematics_page'] };
      scanFunctionLines(scanner, helperRange.start, helperRange.end, subHelpers);
      lineNum++;
      continue;
    }
    if (helperFunctions['build_kinematics_page'] && !trimmed.startsWith('PageShp ') && trimmed.includes('build_kinematics_page()')) {
      const helperRange = helperFunctions['build_kinematics_page'];
      scanFunctionLines(scanner, helperRange.start, helperRange.end, {});
      lineNum++;
      continue;
    }

    // Consume lambdas/callbacks:
    // optgroup->m_on_change = ...;
    // auto append_retraction_option = ...;
    // auto append_ironing_option = ...;
    // btn->Bind(...)
    if (
      trimmed.startsWith('optgroup->m_on_change') ||
      trimmed.startsWith('auto append_retraction_option =') ||
      trimmed.startsWith('auto append_ironing_option =') ||
      trimmed.startsWith('btn->Bind(')
    ) {
      const endBlockLine = consumeMatchingBraces(lineNum, endLine);
      lineNum = endBlockLine + 1;
      continue;
    }

    // Skip searcher indexing block in build_unregular_pages
    if (trimmed.includes('extruder_page()') && (trimmed.includes('settings_index') || (allLines[lineNum] && allLines[lineNum].includes('settings_index')))) {
      const endBlockLine = consumeMatchingBraces(lineNum, endLine);
      lineNum = endBlockLine + 1;
      continue;
    }

    // Skip loop in build_unregular_pages checking if "Motion ability" exists
    if (trimmed.startsWith('for (size_t i = n_before_extruders; i < m_pages.size()')) {
      while (!allLines[lineNum - 1].includes('break;') && lineNum < endLine) {
        lineNum++;
      }
      if (allLines[lineNum - 1].trim() === '}') lineNum++;
      continue;
    }

    // Multi-line vector variable declarations:
    // const std::vector<std::string> speed_axes{ ... };
    // const std::vector<std::string> axes{ "x", "y", "z", "e" };
    if (trimmed.startsWith('const std::vector<std::string>')) {
      let fullStmt = trimmed;
      while (!fullStmt.includes('};') && lineNum < endLine) {
        lineNum++;
        fullStmt += ' ' + allLines[lineNum - 1].trim();
      }
      const vecMatch = fullStmt.match(/const\s+std::vector<std::string>\s+(\w+)\s*\{([^}]+)\}/);
      if (vecMatch) {
        const varName = vecMatch[1];
        const items = [...vecMatch[2].matchAll(/"([^"]+)"/g)].map(m => m[1]);
        scanner.vectors.set(varName, items);
      }
      lineNum++;
      continue;
    }

    // Check if statement with block {
    const ifMatch = trimmed.match(/^if\s*\((.*)\)\s*\{?$/);
    if (ifMatch) {
      let cond = ifMatch[1].trim();
      const isLayoutCond =
        cond.includes('m_use_silent_mode') ||
        cond.includes('is_marlin_flavor') ||
        cond.includes('from_initial_build') ||
        cond.includes('extruder_page()') ||
        cond.includes('wxGetApp().getAgent()');

      if (isLayoutCond) {
        let braceLine = lineNum;
        if (!trimmed.includes('{') && allLines[lineNum].includes('{')) {
          braceLine = lineNum + 1;
        }
        const blockEnd = consumeMatchingBraces(braceLine, endLine);
        scanner.conditionBlocks.push({ endLine: blockEnd, condition: cond });
      }
      lineNum++;
      continue;
    }

    // Check page declaration:
    // auto page = add_options_page(L("Quality"), "custom-gcode_quality");
    // page = add_options_page(L("Strength"), "custom-gcode_strength");
    // PageShp page = add_options_page(...);
    if (trimmed.includes('add_options_page(')) {
      const callStart = trimmed.indexOf('add_options_page(') + 'add_options_page('.length;
      const callEnd = trimmed.lastIndexOf(')');
      if (callEnd > callStart) {
        const rawArgs = trimmed.substring(callStart, callEnd);
        const args = splitArgs(rawArgs);
        const title = cleanStringLiteral(args[0]);
        const icon = cleanStringLiteral(args[1]);
        scanner.addPage(title, icon, scanner.getCurrentCondition(lineNum));
        lineNum++;
        continue;
      }
    }

    // Check optgroup declaration:
    // auto optgroup = page->new_optgroup(L("Layer height"), L"param_layer_height");
    // optgroup = page->new_optgroup(L("Line width"), L"param_line_width");
    // ConfigOptionsGroupShp retraction_optgroup = page->new_optgroup(L("Retraction"), L"param_retraction");
    if (trimmed.includes('page->new_optgroup(')) {
      const callStart = trimmed.indexOf('page->new_optgroup(') + 'page->new_optgroup('.length;
      const callEnd = trimmed.lastIndexOf(')');
      if (callEnd > callStart) {
        const rawArgs = trimmed.substring(callStart, callEnd);
        const args = splitArgs(rawArgs);
        const title = cleanStringLiteral(args[0]);
        let anchor = '';
        if (args.length > 1) {
          anchor = cleanStringLiteral(args[1]);
          if (anchor === '0' || anchor === '-1') anchor = '';
        }
        scanner.addGroup(title, anchor, scanner.getCurrentCondition(lineNum));
        lineNum++;
        continue;
      }
    }

    // Check append_single_option_line:
    // optgroup->append_single_option_line("layer_height", "quality_settings_layer_height");
    // optgroup->append_single_option_line("layer_height");
    // optgroup->append_single_option_line("nozzle_diameter", "printer_extruder_basic_information#nozzle-diameter", extruder_idx);
    // optgroup->append_single_option_line(option, "printer_basic_information_printable_space#excluded-bed-area");
    if (trimmed.includes('optgroup->append_single_option_line(')) {
      const callStart = trimmed.indexOf('optgroup->append_single_option_line(') + 'optgroup->append_single_option_line('.length;
      const callEnd = trimmed.lastIndexOf(')');
      if (callEnd > callStart) {
        const rawArgs = trimmed.substring(callStart, callEnd);
        const args = splitArgs(rawArgs);
        const firstArg = args[0];
        let rawKey = '';
        let rawHelp = args.length > 1 ? cleanStringLiteral(args[1]) : '';
        let rawIdx = args.length > 2 ? args[2] : undefined;

        if (scanner.optVars.has(firstArg)) {
          const varInfo = scanner.optVars.get(firstArg);
          rawKey = varInfo.key;
          if (rawIdx === undefined) rawIdx = varInfo.index;
          if (!rawHelp) rawHelp = varInfo.helpLink || '';
        } else {
          rawKey = cleanStringLiteral(firstArg);
        }

        const { key, index } = parseKeyAndIndex(rawKey, rawIdx);
        const lineObj = {
          type: 'option',
          key,
        };
        if (index !== undefined) lineObj.index = index;
        if (rawHelp) lineObj.helpLink = rawHelp;

        scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
        lineNum++;
        continue;
      }
    }

    // Check create_line_with_widget:
    // create_line_with_widget(optgroup.get(), "printable_area", "custom-svg-and-png-bed-textures_124612", ...
    if (trimmed.startsWith('create_line_with_widget(')) {
      const widgetMatch = trimmed.match(/create_line_with_widget\s*\([^,]+,\s*"([^"]+)"(?:\s*,\s*([^,)]+))?/);
      if (widgetMatch) {
        const key = widgetMatch[1];
        const helpLink = widgetMatch[2] ? cleanStringLiteral(widgetMatch[2]) : '';
        const lineObj = {
          type: 'custom',
          note: `custom widget: ${key}`,
          key,
        };
        if (helpLink) lineObj.helpLink = helpLink;
        scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
      }
      const endWidgetLine = consumeMatchingBraces(lineNum, endLine);
      lineNum = endWidgetLine + 1;
      continue;
    }

    // Check append_option_line(optgroup, key, label_path):
    // append_option_line(optgroup, speed_axis, "printer_motion_ability#speed-limitation");
    // append_option_line(optgroup, "machine_max_acceleration_extruding", "printer_motion_ability#acceleration-limitation");
    const appendOptLineMatch = trimmed.match(/append_option_line\s*\(\s*\w+\s*,\s*([^,]+)\s*,\s*([^,)]+)\s*\);?/);
    if (appendOptLineMatch) {
      const rawKey = appendOptLineMatch[1].trim();
      const helpLink = cleanStringLiteral(appendOptLineMatch[2]);
      let key = cleanStringLiteral(rawKey);

      const lineObj = {
        type: 'option',
        key,
      };
      if (helpLink) lineObj.helpLink = helpLink;
      scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
      lineNum++;
      continue;
    }

    // Check Option variable assignments / constructor:
    // Option option = optgroup->get_option("bed_exclude_area");
    // option = optgroup->get_option("notes");
    // Option chamber_temp_target_opt = optgroup->get_option("chamber_temperature");
    // Option option(def, "extruders_count");
    // auto option = Option(def, "full_power_legend");
    // option = Option(def, "silent_legend");
    const optGetMatch = trimmed.match(/(?:(?:auto|Option)\s+)?(\w+)\s*=\s*optgroup->get_option\s*\(\s*"([^"]+)"(?:\s*,\s*([^)]+))?\s*\);?/);
    if (optGetMatch) {
      const varName = optGetMatch[1];
      const key = optGetMatch[2];
      const idx = optGetMatch[3] ? optGetMatch[3].trim() : undefined;
      scanner.optVars.set(varName, { key, index: idx });
      lineNum++;
      continue;
    }
    const optConstMatch = trimmed.match(/(?:auto\s+(\w+)\s*=\s*Option\s*\([^,]+,\s*"([^"]+)"|(\w+)\s*=\s*Option\s*\([^,]+,\s*"([^"]+)"|Option\s+(\w+)\s*\([^,]+,\s*"([^"]+)")/);
    if (optConstMatch) {
      const varName = optConstMatch[1] || optConstMatch[3] || optConstMatch[5];
      const key = optConstMatch[2] || optConstMatch[4] || optConstMatch[6];
      scanner.optVars.set(varName, { key, index: undefined });
      lineNum++;
      continue;
    }

    // Check multi-option Line construction / reassignment:
    // Line line = { L("Overhang speed"), L("...") };
    // Line resonance_line = {L("Resonance Avoidance Speed"), L""};
    // line = { L("Bridge"), L("...") };
    // auto line = Line{ "", "" };
    // Line line = Line{ ... };
    // Line line {"",""};
    if (
      trimmed.startsWith('Line ') ||
      trimmed.startsWith('auto line =') ||
      trimmed.startsWith('line = {') ||
      trimmed.startsWith('line = Line{') ||
      trimmed.match(/^\w+_line\s*=\s*\{/) ||
      trimmed.match(/^\w+\s*=\s*\{\s*L\(/)
    ) {
      let fullLineStmt = trimmed;
      while (!fullLineStmt.includes('};') && !fullLineStmt.includes(');') && !fullLineStmt.endsWith('}') && lineNum < endLine) {
        lineNum++;
        fullLineStmt += ' ' + allLines[lineNum - 1].trim();
      }
      const braceMatch = fullLineStmt.match(/\{\s*([^,]+?)\s*(?:,\s*([\s\S]*))?\s*\}/);
      if (braceMatch) {
        const label = cleanStringLiteral(braceMatch[1]);
        scanner.currentLineBuilder = {
          type: 'line',
          label,
          options: [],
        };
      }
      lineNum++;
      continue;
    }

    // Check line.label_path = "...";
    const labelPathMatch = trimmed.match(/\w+\.label_path\s*=\s*([^;]+);?/);
    if (labelPathMatch && scanner.currentLineBuilder) {
      scanner.currentLineBuilder.helpLink = cleanStringLiteral(labelPathMatch[1]);
      lineNum++;
      continue;
    }

    // Check line.append_option(...)
    if (trimmed.includes('.append_option(')) {
      const startIdx = trimmed.indexOf('.append_option(') + '.append_option('.length;
      const lastParen = trimmed.lastIndexOf(')');
      if (lastParen > startIdx) {
        const arg = trimmed.substring(startIdx, lastParen).trim();
        let optKey = null;

        const getOptMatch = arg.match(/optgroup->get_option\s*\(\s*(?:\"([^\"]+)\"|(\w+))(?:\s*,\s*([^)]+))?\s*\)/);
        if (getOptMatch) {
          optKey = getOptMatch[1] || (scanner.optVars.has(getOptMatch[2]) ? scanner.optVars.get(getOptMatch[2]).key : getOptMatch[2]);
        } else if (scanner.optVars.has(arg)) {
          optKey = scanner.optVars.get(arg).key;
        } else {
          const optMatch = arg.match(/Option\s*\([^,]+,\s*"([^"]+)"/);
          if (optMatch) {
            optKey = optMatch[1];
          } else {
            const cleaned = cleanStringLiteral(arg);
            if (cleaned) optKey = cleaned;
          }
        }

        if (optKey && scanner.currentLineBuilder) {
          scanner.currentLineBuilder.options.push(optKey);
        }
      }
      lineNum++;
      continue;
    }

    // Check optgroup->append_line(line);
    const appendLineMatch = trimmed.match(/optgroup->append_line\s*\(\s*(\w+)\s*\);?/);
    if (appendLineMatch) {
      if (scanner.currentLineBuilder) {
        if (
          scanner.currentLineBuilder.options.includes('full_power_legend') ||
          scanner.currentLineBuilder.options.includes('silent_legend')
        ) {
          scanner.addLine({
            type: 'custom',
            note: 'legend: Normal / Silent',
          }, scanner.getCurrentCondition(lineNum));
        } else {
          scanner.addLine(scanner.currentLineBuilder, scanner.getCurrentCondition(lineNum));
        }
        scanner.currentLineBuilder = null;
      }
      lineNum++;
      continue;
    }

    // Check for loops:
    // 1. Initializer list loop:
    // for (const std::string opt_key : { "k1", "k2", ... })
    //    append_retraction_option(retraction_optgroup, opt_key, extruder_idx);
    //    append_ironing_option(opt_key, extruder_idx);
    if (trimmed.startsWith('for (const std::string opt_key : {') || trimmed.startsWith('for (const std::string opt_key :{')) {
      let listContent = trimmed;
      while (!listContent.includes('})') && lineNum < endLine) {
        lineNum++;
        listContent += ' ' + allLines[lineNum - 1].trim();
      }
      const keys = [...listContent.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      for (const key of keys) {
        scanner.addLine({
          type: 'option',
          key,
          index: 0,
        }, scanner.getCurrentCondition(lineNum));
      }
      let nextLine = '';
      if (lineNum < endLine) {
        nextLine = allLines[lineNum].trim();
      }
      if (nextLine.startsWith('append_retraction_option') || nextLine.startsWith('append_ironing_option')) {
        lineNum++;
      }
      lineNum++;
      continue;
    }

    // 2. Printer publishable retraction options loop:
    if (trimmed.includes('publishable_printer_retraction_options()')) {
      for (const item of printerRetractionOptions) {
        const lineObj = {
          type: 'option',
          key: item.key,
          index: 0,
        };
        if (item.helpLink) lineObj.helpLink = item.helpLink;
        scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
      }
      let nextLine = '';
      if (lineNum < endLine) {
        nextLine = allLines[lineNum].trim();
      }
      if (nextLine.includes('append_single_option_line')) {
        lineNum++;
      }
      lineNum++;
      continue;
    }

    // 3. Printer publishable z-hop options loop:
    if (trimmed.includes('publishable_printer_z_hop_options()')) {
      for (const item of printerZHopOptions) {
        const lineObj = {
          type: 'option',
          key: item.key,
          index: 0,
        };
        if (item.helpLink) lineObj.helpLink = item.helpLink;
        scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
      }
      let nextLine = '';
      if (lineNum < endLine) {
        nextLine = allLines[lineNum].trim();
      }
      if (nextLine.includes('append_single_option_line')) {
        lineNum++;
      }
      lineNum++;
      continue;
    }

    // 4. for (const std::string &speed_axis : speed_axes) or for (const std::string &axis : axes)
    const forVectorMatch = trimmed.match(/for\s*\(.*:\s*(\w+)\s*\)/);
    if (forVectorMatch && scanner.vectors.has(forVectorMatch[1])) {
      const vecItems = scanner.vectors.get(forVectorMatch[1]);
      let nextLine = '';
      if (lineNum < endLine) {
        nextLine = allLines[lineNum].trim();
      }
      const appMatch = nextLine.match(/append_option_line\s*\(\s*\w+\s*,\s*([^,]+)\s*,\s*([^)]+)\)/);
      if (appMatch) {
        const keyExpr = appMatch[1].trim();
        const help = cleanStringLiteral(appMatch[2]);
        const prefixMatch = keyExpr.match(/"([^"]+)"\s*\+\s*\w+/);

        for (const item of vecItems) {
          const key = prefixMatch ? (prefixMatch[1] + item) : item;
          const lineObj = {
            type: 'option',
            key,
          };
          if (help) lineObj.helpLink = help;
          scanner.addLine(lineObj, scanner.getCurrentCondition(lineNum));
        }
        lineNum++; // skip append_option_line
      }
      if (lineNum < endLine && allLines[lineNum].trim() === '}') {
        lineNum++;
      }
      lineNum++;
      continue;
    }

    // Multi-line statement continuation consuming for option.opt.
    if (trimmed.startsWith('option.opt.') || trimmed.startsWith('chamber_temp_target_opt.opt.') || trimmed.startsWith('chamber_min_temp_opt.opt.')) {
      while (!trimmed.endsWith(';') && lineNum < endLine) {
        lineNum++;
        trimmed = allLines[lineNum - 1].trim();
      }
      lineNum++;
      continue;
    }

    // Ignored statements (visual styling, callbacks, setup):
    if (
      trimmed.startsWith('option.') ||
      trimmed.startsWith('optgroup->') ||
      trimmed.startsWith('retraction_optgroup->') ||
      trimmed.startsWith('ironing_optgroup->') ||
      trimmed.startsWith('page->') ||
      trimmed.startsWith('def.') ||
      trimmed.startsWith('def->') ||
      trimmed.startsWith('ConfigOptionDef def') ||
      trimmed.startsWith('Freeze()') ||
      trimmed.startsWith('Thaw()') ||
      trimmed.startsWith('m_rebuild_kinematics_page =') ||
      trimmed.startsWith('m_pages.') ||
      trimmed.startsWith('n_before_extruders') ||
      trimmed.startsWith('wxTheApp->CallAfter') ||
      trimmed.startsWith('return ') ||
      trimmed.startsWith('return;') ||
      trimmed.startsWith('m_initial_extruders_count =') ||
      trimmed.startsWith('m_extruders_count =') ||
      trimmed.startsWith('m_sys_extruders_count =') ||
      trimmed.startsWith('m_extruder_variant_list =') ||
      trimmed.startsWith('auto   *nozzle_diameter =') ||
      trimmed.startsWith('auto *nozzle_diameter =') ||
      trimmed.startsWith('const Preset* parent_preset =') ||
      trimmed.startsWith(': m_presets->') ||
      trimmed.startsWith('static_cast<const ConfigOptionFloats*>') ||
      trimmed.startsWith('auto registered_printer_agents =') ||
      trimmed.startsWith('auto edit_custom_gcode_fn =') ||
      trimmed.startsWith('const int gcode_field_height =') ||
      trimmed.startsWith('const int notes_field_height =') ||
      trimmed.startsWith('const size_t extruder_idx =') ||
      trimmed.startsWith('const int extruder_idx =') ||
      trimmed.startsWith('size_t existed_page =') ||
      trimmed.startsWith('break;') ||
      trimmed.startsWith('else') ||
      trimmed.startsWith('m_extruders_count_old =') ||
      trimmed.startsWith('rebuild_page_tree();') ||
      trimmed.startsWith('reload_config();') ||
      trimmed.startsWith('apply_searcher();') ||
      trimmed.startsWith('m_presets =') ||
      trimmed.startsWith('load_initial_data();')
    ) {
      lineNum++;
      continue;
    }

    // Anything else we couldn't parse: record into unparsedList
    unparsedList.push({
      line: lineNum,
      text: rawLine.trim(),
    });

    lineNum++;
  }
}

// 4. Find functions to scan
const tabPrintRange = findFunctionRange(allLines, /void\s+TabPrint::build\s*\(\s*\)/);
const tabFilamentRange = findFunctionRange(allLines, /void\s+TabFilament::build\s*\(\s*\)/);
const addFilamentOverridesRange = findFunctionRange(allLines, /void\s+TabFilament::add_filament_overrides_page\s*\(\s*\)/);
const tabPrinterFffRange = findFunctionRange(allLines, /void\s+TabPrinter::build_fff\s*\(\s*\)/);
const buildUnregularPagesRange = findFunctionRange(allLines, /void\s+TabPrinter::build_unregular_pages\s*\(/);
const buildKinematicsPageRange = findFunctionRange(allLines, /PageShp\s+TabPrinter::build_kinematics_page\s*\(\s*\)/);

const tabs = [];

// Print tab
if (tabPrintRange) {
  const scanner = new TabScanner();
  scanFunctionLines(scanner, tabPrintRange.start, tabPrintRange.end, {});
  tabs.push({
    id: 'print',
    function: 'TabPrint::build',
    pages: scanner.pages,
  });
}

// Filament tab
if (tabFilamentRange) {
  const scanner = new TabScanner();
  const helpers = {
    add_filament_overrides_page: addFilamentOverridesRange,
  };
  scanFunctionLines(scanner, tabFilamentRange.start, tabFilamentRange.end, helpers);
  tabs.push({
    id: 'filament',
    function: 'TabFilament::build',
    pages: scanner.pages,
  });
}

// Printer tab
if (tabPrinterFffRange) {
  const scanner = new TabScanner();
  const helpers = {
    build_unregular_pages: buildUnregularPagesRange,
    build_kinematics_page: buildKinematicsPageRange,
  };
  scanFunctionLines(scanner, tabPrinterFffRange.start, tabPrinterFffRange.end, helpers);
  tabs.push({
    id: 'printer',
    function: 'TabPrinter::build_fff',
    pages: scanner.pages,
  });
}

const output = {
  source: {
    file: 'src/slic3r/GUI/Tab.cpp',
    gitBlob,
  },
  tabs,
  unparsed: unparsedList,
};

fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
fs.writeFileSync(outJsonPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`Successfully generated layout to ${outJsonPath}`);
