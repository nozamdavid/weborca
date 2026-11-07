import assert from 'node:assert/strict';

export async function controlValue(input) {
  await assertPhoneSelect(input);
  return await input.getAttribute('aria-haspopup') === 'dialog' ? input.getAttribute('data-value') : input.inputValue();
}
export async function selectControl(input, value) {
  await assertPhoneSelect(input);
  if (await input.getAttribute('aria-haspopup') !== 'dialog') return input.selectOption(String(value));
  await input.click();
  await input.page().locator(`.mobile-selector [role=option][data-value=${JSON.stringify(String(value))}]`).click();
  await input.page().locator('.mobile-selector').waitFor({ state: 'detached' });
}
export async function controlOptions(input) {
  await assertPhoneSelect(input);
  if (await input.getAttribute('aria-haspopup') !== 'dialog') return input.locator('option').evaluateAll(options => options.map(option => option.value));
  await input.click();
  const values = await input.page().locator('.mobile-selector [role=option]').evaluateAll(options => options.map(option => option.dataset.value));
  await input.page().keyboard.press('Escape');
  return values;
}

async function assertPhoneSelect(input) {
  if (await input.page().evaluate(() => matchMedia('(max-width: 800px)').matches) &&
      await input.evaluate(node => node.tagName === 'SELECT' || node.hasAttribute('aria-haspopup'))) {
    assert.equal(await input.evaluate(node => node.tagName), 'BUTTON', 'phone select uses custom button');
    assert.equal(await input.getAttribute('aria-haspopup'), 'dialog', 'phone select opens dialog');
  }
}

// These are actual native prerequisites from ConfigRules.cpp. No visibility or
// enablement flags are replaced: each probe evaluates the production engine.
async function discoverContexts(page) {
  return page.evaluate(async () => {
    const engine = window.__orcaEngine;
    const baseline = await engine.getConfig();
    const defs = window.__appStore.getState().configDefs;
    const contexts = [{ name: 'baseline', options: {} }];
    const add = (name, options) => contexts.push({ name, options });
    const normal = { enable_support: '1', support_type: 'normal(auto)', support_threshold_angle: '0',
      support_interface_top_layers: '3', support_interface_bottom_layers: '2', support_interface_filament: '2', support_filament: '0' };
    add('normal support and interfaces', normal);
    add('support ironing and raft', { ...normal, support_ironing: '1', raft_layers: '2' });
    for (const style of defs.support_style.enumValues.filter(value => value === 'organic' || value.startsWith('tree'))) {
      add(`tree support: ${style}`, { ...normal, support_type: 'tree(auto)', support_style: style, tree_support_auto_brim: '0', raft_layers: '2' });
    }
    add('skirt and brim ears', { skirt_loops: '2', brim_type: 'brim_ears', brim_width: '5', elefant_foot_compensation: '0.2' });
    add('ironing and alternate walls', { ironing_type: 'top', ironing_pattern: 'rectilinear', zaa_enabled: '1',
      top_surface_expansion: '1', top_surface_pattern: 'archimedeanchords', bottom_surface_pattern: 'concentric', wall_generator: 'classic' });
    for (const pattern of ['gyroid', 'lockedzag', '3dhoneycomb', 'lateral-lattice', 'lightning', 'lateral-honeycomb']) {
      if (defs.sparse_infill_pattern.enumValues.includes(pattern)) add(`infill: ${pattern}`, {
        sparse_infill_density: '20%', sparse_infill_pattern: pattern, infill_combination: '1', sparse_infill_rotate_template: '0,90' });
    }
    add('multifilament type 2 wipe tower', { single_extruder_multi_material: '0', nozzle_diameter: '0.4,0.4', wipe_tower_type: 'type2',
      wipe_tower_wall_type: 'rectangle', enable_prime_tower: '1', enable_tower_interface_features: '1', toolchange_ordering: 'cyclic', ooze_prevention: '1', preheat_steps: '2' });
    add('type 2 cone wipe tower', { nozzle_diameter: '0.4', single_extruder_multi_material: '1', wipe_tower_type: 'type2', enable_prime_tower: '1', wipe_tower_wall_type: 'cone' });
    add('Bambu multiple extruders', { nozzle_diameter: '0.4,0.4', long_retractions_when_ec: '1,1' });
    add('printer and filament capabilities', { auxiliary_fan: '1', support_air_filtration: '1', support_multi_bed_types: '1',
      activate_air_filtration: '1,1', activate_air_filtration_during_print: '1,1', activate_air_filtration_on_completion: '1,1',
      enable_pressure_advance: '1,1', adaptive_pressure_advance: '1,1', close_fan_the_first_x_layers: '0,0',
      pellet_modded_printer: '1', support_parallel_printheads: '1', resonance_avoidance: '1',
      volumetric_speed_coefficients: '1 0 0 0 0 0;1 0 0 0 0 0', enable_long_retraction_when_cut: '1', long_retractions_when_cut: '1,1' });
    add('filament cutter overrides and cooling filter', { enable_long_retraction_when_cut: '2',
      filament_long_retractions_when_cut: '1,1', filament_retraction_distances_when_cut: '10,10', support_cooling_filter: '1' });
    add('Marlin junction deviation and input shaping', { gcode_flavor: 'marlin2', machine_max_junction_deviation: '0.02,0.02',
      emit_machine_limits_to_gcode: '1', input_shaping_emit: '1' });
    add('flow and wall features', { set_other_flow_ratios: '1', max_volumetric_extrusion_rate_slope: '1', reduce_crossing_wall: '1',
      wipe_inward: '1', role_based_wipe_speed: '0', make_overhang_printable: '1', only_one_wall_top: '1', hole_to_polyhole: '1',
      overhang_reverse: '1', overhang_reverse_internal_only: '0', small_area_infill_flow_compensation: '1',
      seam_slope_type: 'external', seam_slope_conditional: '1', seam_slope_entire_loop: '0', interlocking_beam: '1' });
    for (const noise of ['perlin', 'ripple']) add(`fuzzy skin: ${noise}`, { fuzzy_skin: 'external', fuzzy_skin_noise_type: noise });
    add('spiral vase smoothing', { spiral_mode: '1', spiral_mode_smooth: '1', wall_loops: '1', top_shell_layers: '0',
      sparse_infill_density: '0%', enable_support: '0', enforce_support_layers: '0', detect_thin_wall: '0', overhang_reverse: '0' });
    const reset = Object.fromEntries([...new Set(contexts.flatMap(context => Object.keys(context.options)))].map(key => [key, baseline[key]]));
    const matches = {};
    const snapshots = [];
    for (const context of contexts) {
      const result = await engine.setOptions({ ...reset, ...context.options });
      if (result.errors?.length) throw new Error(`${context.name}: ${JSON.stringify(result.errors)}`);
      const fieldsByKind = {};
      for (const kind of ['print', 'printer', 'filament']) fieldsByKind[kind] = (await engine.call('evaluateRules', { kind, filamentIndex: 0 })).fields;
      const fields = Object.assign({}, fieldsByKind.print, fieldsByKind.printer, fieldsByKind.filament);
      snapshots.push({ name: context.name, options: context.options });
      for (const key of Object.keys(defs)) {
        const field = fields[key];
        const indexed = fields[`${key}#0`] ?? field;
        const geometry = key === 'extruder_printable_height' || ['point', 'point3', 'points', 'pointsGroups', 'intsGroups'].includes(defs[key].type);
        const objectContext = key === 'flush_into_objects';
        if (baseline[key] !== undefined && !defs[key].readonly && (objectContext || field?.visible !== false && indexed?.visible !== false) &&
          (geometry || field?.enabled !== false && indexed?.enabled !== false) && !matches[key]) matches[key] = context;
      }
    }
    await engine.setOptions(reset);
    return { reset, matches, snapshots };
  });
}

async function activateContext(page, discovery, context) {
  await page.evaluate(async options => {
    const engine = window.__orcaEngine;
    const result = await engine.setOptions(options);
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    const fields = {};
    for (const kind of ['print', 'printer', 'filament']) {
      const rules = await engine.call('evaluateRules', { kind, filamentIndex: 0 });
      Object.assign(fields, rules.fields);
    }
    window.__appStore.setState({ currentConfig: await engine.getConfig(), rulesState: { fields, fixes: [], messages: [] } });
  }, { ...discovery.reset, ...context.options });
}

function unavailableReason(key, def, context) {
  if (def.readonly) return { category: 'read-only', detail: 'Native definition is read-only.' };
  if (!context.inConfig) {
    if (/^(compatible_|inherits|different_settings_to_system|preset_name)/.test(key)) return { category: 'metadata', detail: 'Preset inheritance/compatibility metadata is excluded from full_config().' };
    if (key === 'brim_ears') return { category: 'inert-definition', detail: 'Unused boolean definition (PrintConfig.cpp:1997), absent from PrintObjectConfig/PrintRegionConfig. Brim.cpp:473 consumes brim_type == btEar, not this boolean.' };
    if (key === 'tree_support_with_infill') return { category: 'retired-legacy', detail: 'PrintConfig.cpp:9390 explicitly ignores this obsolete key during handle_legacy; no slicing consumer or static FFF member.' };
    if (/^(extruder_nozzle_|handle_hotend_|filament_max_temperature_drop_when_ec)/.test(key)) return { category: 'inert-definition', detail: 'PrintConfig.cpp registers this forward-compatibility/internal key without a slicing consumer; it is absent from full_config().' };
    return { category: 'non-FFF', detail: 'SLA print/material definition is absent from the FFF full_config().' };
  }
  if (['enable_wrapping_detection', 'wrapping_detection_gcode'].includes(key)) return { category: 'runtime-capability', detail: 'Native RuleContext.support_wrapping_detection is always false in the WASM engine (desktop device capability).' };
  if (['scan_first_layer', 'bbl_calib_mark_logo', 'bbl_use_printhost', 'timelapse_type', 'long_retractions_when_ec', 'retraction_distances_when_ec'].includes(key)) return { category: 'vendor-context', detail: 'Requires an actual Bambu Lab vendor printer preset; extruder-change fields also require multiple extruders.' };
  return { category: 'unresolved-FFF', detail: 'No tested native context enables this supported FFF field. See native/context and attemptedContexts for exact prerequisites.' };
}

async function coverContextSetting(page, key, report) {
  console.log(`Context UI/native check: ${key}`);
  const snapshot = () => page.evaluate(async () => ({ config: await window.__orcaEngine.getConfig(),
    objects: (await window.__orcaEngine.call('getObjectTree', {})).objects,
    plates: await window.__orcaEngine.call('listPlates', {}) }));
  const before = await snapshot();
  const isObject = ['extruder', 'flush_into_objects'].includes(key);
  const target = isObject ? Number(await controlValue(page.locator('#mobile-object-target'))) : await page.evaluate(() => window.__platesStore.getState().activePlateIndex);
  if (isObject) {
    assert.equal(before.objects.find(object => object.id === target).instances.length, 2, 'logical object shared by two instances');
    assert.equal(before.plates.filter(plate => plate.instances.some(instance => instance.objectId === target)).length, 2, 'shared object spans two plates');
  }
  const input = page.locator(`#setting-input-${key}`);
  if (key === 'extruder') {
    const prior = before.objects.find(object => object.id === target);
    assert.ok(prior.volumes.length > 1, 'generated multipart fixture');
    await selectControl(page.locator('#mobile-part-target'), String(prior.volumes[0].id));
    await selectControl(input, '2');
    await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
    const partAfter = await snapshot();
    const edited = partAfter.objects.find(object => object.id === target);
    assert.equal(edited.volumes[0].extruder, 2, 'native first-part assignment shared across instances');
    assert.deepEqual(edited.volumes.slice(1), prior.volumes.slice(1), 'sibling parts unchanged');
    assert.deepEqual(edited.instances, prior.instances, 'shared instances preserved');
    assert.deepEqual(partAfter.objects.filter(object => object.id !== target), before.objects.filter(object => object.id !== target), 'other logical objects unchanged');
    assert.deepEqual(partAfter.plates, before.plates, 'cross-plate memberships preserved');
    assert.deepEqual(partAfter.config, before.config, 'part edit leaves global config intact');
    await page.screenshot({ path: 'wasm/build/tests-app/mobile/part-target-390.png' });
    await selectControl(input, String(prior.volumes[0].extruder));
    await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
    await selectControl(page.locator('#mobile-part-target'), '');
  }
  const original = key === 'flush_into_objects' ? await input.isChecked() : await controlValue(input);
  const replacement = key === 'flush_into_objects' ? !original : key === 'extruder' ? '2' : 'Customize';
  if (key === 'flush_into_objects') await input.setChecked(replacement);
  else await selectControl(input, replacement);
  try {
    await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
  } catch (error) {
    throw new Error(`${key}: ${await page.locator('.mobile-flow-content').innerText()}`, { cause: error });
  }
  const after = await snapshot();
  assert.deepEqual(after.config, before.config, `${key}: context edit leaves global config intact`);
  if (isObject) {
    const object = after.objects.find(object => object.id === target);
    if (key === 'extruder') assert.ok(object.volumes.every(volume => volume.extruder === 2), 'native object filament assignment');
    else assert.equal(object.config[key], replacement ? '1' : '0', 'native object flush override');
    assert.deepEqual(after.objects.filter(object => object.id !== target), before.objects.filter(object => object.id !== target), `${key}: other objects preserved`);
    assert.deepEqual(after.plates, before.plates, `${key}: plates preserved`);
    const prior = before.objects.find(object => object.id === target);
    assert.deepEqual(Object.fromEntries(Object.entries(object.config).filter(([name]) => name !== key)),
      Object.fromEntries(Object.entries(prior.config).filter(([name]) => name !== key)), `${key}: sibling overrides preserved`);
  } else {
    const config = after.plates.find(plate => plate.index === target).config;
    const sequenceKey = key === 'first_layer_sequence_choice' ? 'first_layer_print_sequence' : 'other_layers_print_sequence';
    assert.equal(config[sequenceKey], key === 'first_layer_sequence_choice' ? '1,2' : '2,2147483646,1,2', `${key}: native sequence serialization`);
    if (key === 'other_layers_sequence_choice') assert.equal(config.other_layers_print_sequence_nums, '1');
    assert.deepEqual(after.objects, before.objects, `${key}: objects preserved`);
    assert.deepEqual(after.plates.filter(plate => plate.index !== target), before.plates.filter(plate => plate.index !== target), `${key}: other plates preserved`);
  }
  await page.screenshot({ path: `wasm/build/tests-app/mobile/context-${key}-390.png` });
  if (key === 'flush_into_objects') await input.setChecked(original);
  else await selectControl(input, original);
  await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
  const restored = await snapshot();
  if (isObject) {
    const prior = before.objects.find(object => object.id === target);
    const object = restored.objects.find(object => object.id === target);
    if (key === 'extruder') assert.deepEqual(object.volumes.map(volume => volume.extruder), prior.volumes.map(volume => volume.extruder));
    else {
      assert.equal(object.config[key], original ? '1' : '0');
      if (!Object.hasOwn(prior.config, key)) await page.evaluate(async ({ target, key }) => window.__objectListStore.getState().resetObjectConfig(target, null, [key]), { target, key });
    }
  } else {
    const config = restored.plates.find(plate => plate.index === target).config;
    assert.equal(config[key === 'first_layer_sequence_choice' ? 'first_layer_print_sequence' : 'other_layers_print_sequence'], '', 'Auto disables custom sequence');
    if (key === 'other_layers_sequence_choice') assert.equal(config.other_layers_print_sequence_nums, '0');
    await page.evaluate(async ({ key, target }) => {
      const first = key === 'first_layer_sequence_choice';
      await window.__platesStore.getState().setPlateConfig(target, {
        [first ? 'first_layer_print_sequence' : 'other_layers_print_sequence']: first ? '2,1' : '2,10,2,1,11,2147483646,1,2',
        ...(!first ? { other_layers_print_sequence_nums: '2' } : {}), skirt_start_angle: '12'
      });
    }, { key, target });
    const saved = await snapshot();
    await selectControl(input, 'Customize');
    await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
    assert.deepEqual(await snapshot(), saved, `${key}: saved order/ranges and sibling overrides preserved`);
    await selectControl(input, 'Auto');
    await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
  }
  report.contextWrites ??= [];
  report.contextWrites.push({ key, target, context: isObject ? 'object' : 'plate', nativeWrite: true, restored: true,
    detail: key === 'extruder' ? 'Object/part filament assignment: ObjectOps.cpp:437 stores single-part assignments on the logical object; PrintObject.cpp:3880 applies extruder to region options.' :
      key === 'flush_into_objects' ? 'Object override: PrintConfig.hpp:1264 and GCode/ToolOrdering.cpp:3329; edited through objectListStore.setObjectConfig.' :
      'Plate UI choice adapter: GUI/Tab.cpp:3927-3972 maps choices to sequence arrays; ParameterUtils.cpp:11 decodes ranges; GCode/ToolOrdering.cpp:1751 consumes them. Engine.cpp:2539 applies current plate config during slice.' });
  report.cells++;
}

/** Every runtime definition gets a real mobile widget or an explicit skip reason. */
export async function coverMobileSettings(page, keys, previous) {
  const discovery = await discoverContexts(page);
  const report = previous ?? { total: keys.length, editable: 0, skipped: [], types: {}, editableTypes: {}, widgets: {}, cells: 0, changed: [], failures: [], contexts: [], activated: [], recommendations: [] };
  const printer = await page.evaluate(() => window.__appStore.getState().selectedPrinter);
  report.contexts.push(...discovery.snapshots.map(context => ({ printer, ...context })));
  report.attemptedContexts ??= {};
  const changedTypes = new Set(report.changed.map(item => item.type));
  for (const key of keys) {
    report.attemptedContexts[key] = [...(report.attemptedContexts[key] ?? []),
      ...discovery.snapshots.map(context => ({ printer, name: context.name }))];
    if ((report.editable + report.skipped.length) % 100 === 0) console.log(`Settings coverage ${report.editable + report.skipped.length}/${report.total}: ${key}`);
    await page.waitForFunction(key => {
      const row = document.querySelector('[data-mobile-key]');
      return row?.dataset.mobileKey === key && row.dataset.widget !== 'loading';
    }, key);
    const context = discovery.matches[key] ?? { name: 'baseline', options: {} };
    await activateContext(page, discovery, context);
    await page.waitForFunction(() => document.querySelector('[data-mobile-key]')?.dataset.widget !== 'loading');
    if (context.name !== 'baseline') report.activated.push({ key, printer, context: context.name });
    const row = await page.locator('[data-mobile-key]').evaluate(node => ({
      widget: node.dataset.widget, kind: node.dataset.kind, wholeVector: node.dataset.vectorWhole === 'true',
      reason: node.querySelector('[role=status]')?.textContent,
      context: node.dataset.context,
      controls: [...node.querySelectorAll('[data-cell] input,[data-cell] select,[data-cell] button[aria-haspopup=dialog],[data-cell] textarea')].map(input => ({
        tag: input.getAttribute('aria-haspopup') === 'dialog' ? 'select' : input.tagName.toLowerCase(), type: input.type, disabled: input.disabled,
        nativeTag: input.tagName, popup: input.getAttribute('aria-haspopup'),
        index: Number(input.closest('[data-cell]').dataset.cell)
      }))
    }));
    const def = await page.evaluate(key => window.__appStore.getState().configDefs[key], key);
    report.types[def.type] = (report.types[def.type] || 0) + 1;
    report.widgets[row.widget] = (report.widgets[row.widget] || 0) + 1;
    if (row.widget === 'skip') {
      assert.ok(row.reason, `${key}: skip must explain why`);
      assert.equal(row.controls.length, 0, `${key}: skipped setting cannot write`);
      const native = await page.evaluate(async key => {
        try { return { value: (await window.__orcaEngine.call('getOption', { key })).value }; }
        catch (error) { return { error: String(error) }; }
      }, key);
      const context = await page.evaluate(key => {
        const s = window.__appStore.getState();
        return { inConfig: Object.hasOwn(s.currentConfig, key), readonly: s.configDefs[key].readonly ?? false,
          rule: s.rulesState.fields[key], indexedRule: s.rulesState.fields[`${key}#0`], printer: s.selectedPrinter };
      }, key);
      report.skipped.push({ key, type: def.type, reason: row.reason, native, context,
        ...unavailableReason(key, def, context), attemptedContexts: discovery.snapshots.map(context => context.name) });
    } else {
      assert.ok(row.controls.length, `${key}: editable setting must have a widget`);
      if (row.context) {
        await coverContextSetting(page, key, report);
        report.editable++;
        report.editableTypes[def.type] = (report.editableTypes[def.type] || 0) + 1;
        await page.click('#mobile-next');
        continue;
      }
      for (const control of row.controls) {
        const expectedTag = row.widget === 'select' || row.widget === 'textarea' ? row.widget : 'input';
        assert.equal(control.tag, expectedTag, `${key}: appropriate widget`);
        if (expectedTag === 'select' && page.viewportSize().width <= 800) {
          assert.equal(control.nativeTag, 'BUTTON', `${key}: phone select uses custom button`);
          assert.equal(control.popup, 'dialog', `${key}: phone select opens dialog`);
        }
        if (expectedTag === 'input') assert.equal(control.type, row.widget, `${key}: input type`);
        await page.waitForFunction(({ key, index, tag }) => !document.querySelector(`[data-mobile-key="${key}"] [data-cell="${index}"] ${tag === 'select' ? ':is(select,button[aria-haspopup=dialog])' : tag}`)?.disabled,
          { key, index: control.index, tag: control.tag });
        const result = await page.evaluate(async ({ key, kind, index, vector }) => {
          const engine = window.__orcaEngine;
          const store = window.__appStore.getState();
          const target = { key, ...(vector ? { layoutIndex: index } : {}),
            ...(kind === 'filament' ? { filamentIndex: store.activeFilamentSlot } : {}) };
          const before = (await engine.getConfig())[key];
          const value = (await engine.call('getOption', target)).value;
          const acknowledgement = await engine.call('setOption', { ...target, value });
          const after = (await engine.getConfig())[key];
          return { before, after, acknowledgement };
        }, { key, kind: row.wholeVector ? 'print' : row.kind, index: control.index, vector: !row.wholeVector && ['floats', 'ints', 'strings', 'percents', 'floatsOrPercents', 'bools', 'enums'].includes(def.type) });
        assert.notEqual(result.acknowledgement?.success, false, `${key}: native serialization accepted`);
        assert.equal(result.after, result.before, `${key}: serialized value and sibling cells round-trip`);
        report.cells++;
        if (row.kind === 'filament' && !row.wholeVector) {
          const siblings = await page.evaluate(async ({ key, index }) => {
            const engine = window.__orcaEngine;
            const s = window.__appStore.getState();
            const results = [];
            for (let slot = 0; slot < s.selectedFilaments.length; slot++) {
              if (slot === s.activeFilamentSlot) continue;
              const target = { key, filamentIndex: slot, layoutIndex: index };
              const before = (await engine.getConfig())[key];
              const value = (await engine.call('getOption', target)).value;
              const acknowledgement = await engine.call('setOption', { ...target, value });
              results.push({ slot, before, after: (await engine.getConfig())[key], acknowledgement });
            }
            return results;
          }, { key, index: control.index });
          for (const sibling of siblings) {
            assert.notEqual(sibling.acknowledgement?.success, false, `${key}: filament ${sibling.slot} accepted`);
            assert.equal(sibling.after, sibling.before, `${key}: filament ${sibling.slot} and siblings round-trip`);
            report.cells++;
          }
        }
        if (!changedTypes.has(def.type) || key === 'extruder_printable_height') {
          const input = page.locator(`[data-cell="${control.index}"] ${control.tag === 'select' ? ':is(select,button[aria-haspopup=dialog])' : control.tag}`).first();
          const original = await controlValue(input);
          if (key === 'extruder_printable_height') {
            assert.equal(result.before.split(',').length, 2, 'two height cells required for sibling assertions');
            for (const invalid of ['-1', 'Infinity', 'NaN', '', String(def.max + 1)]) {
              await input.fill(invalid);
              await input.blur();
              assert.equal(await input.getAttribute('aria-invalid'), 'true', 'invalid height rejected');
              assert.equal(await page.locator('#mobile-next').isDisabled(), true, 'invalid height blocks Next');
              assert.equal(await page.evaluate(async key => (await window.__orcaEngine.getConfig())[key], key), result.before, 'invalid height cannot write');
            }
          }
          if (['point', 'point3', 'points', 'pointsGroups', 'intsGroups'].includes(def.type)) {
            await input.fill('not coordinates');
            await input.blur();
            assert.equal(await input.getAttribute('aria-invalid'), 'true', `${key}: malformed geometry rejected`);
            assert.equal(await page.locator('#mobile-next').isDisabled(), true, `${key}: invalid geometry blocks Next`);
            assert.equal(await page.evaluate(async key => (await window.__orcaEngine.getConfig())[key], key), result.before);
          }
          let replacement;
          if (row.widget === 'checkbox') replacement = !(await input.isChecked());
          else if (row.widget === 'select') replacement = (await controlOptions(input)).find(value => value !== original);
          else if (['point', 'point3', 'points', 'pointsGroups', 'intsGroups'].includes(def.type)) {
            replacement = { point: '1,2', point3: '1,2,3', points: '1x2,3x4', pointsGroups: '1x2,3x4#5x6', intsGroups: '1,2#3,4' }[def.type];
          } else if (['float', 'floats', 'int', 'ints', 'percent', 'percents', 'floatOrPercent', 'floatsOrPercents'].includes(def.type)) {
            const value = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, (parseFloat(original) || 0) + 1));
            replacement = String(value) + (original.endsWith('%') ? '%' : '');
          } else replacement = original + ' mobile';
          if (replacement !== undefined && replacement !== original) {
            const write = async value => {
              if (row.widget === 'checkbox') await input.setChecked(value);
              else if (row.widget === 'select') await selectControl(input, value);
              else { await input.fill(value); await input.blur(); }
              await page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length);
              const recommendation = page.getByTestId('fix-close-btn');
              if (await recommendation.isVisible()) {
                report.recommendations.push({ key, reason: await page.getByTestId('fix-reason').innerText() });
                // Closing a recommendation keeps the entered value, allowing
                // the following assertion and exact restore to verify it.
                await recommendation.click();
              }
            };
            await write(replacement);
            const changed = await page.evaluate(async key => ({ value: (await window.__orcaEngine.getConfig())[key], error: window.__appStore.getState().engineError }), key);
            assert.equal(changed.error, null, `${key}: UI edit accepted`);
            assert.notEqual(changed.value, result.before, `${key}: UI handler writes native value`);
            if (key === 'extruder_printable_height') {
              assert.equal(changed.value.split(',')[control.index], replacement, 'native height readback');
              assert.deepEqual(changed.value.split(',').filter((_, index) => index !== control.index), result.before.split(',').filter((_, index) => index !== control.index), 'height siblings preserved');
              await page.screenshot({ path: `wasm/build/tests-app/mobile/height-${control.index}-390.png` });
            }
            await write(row.widget === 'checkbox' ? replacement === false : original);
            assert.equal(await page.evaluate(async key => (await window.__orcaEngine.getConfig())[key], key), result.before, `${key}: UI restore preserves sibling values`);
            changedTypes.add(def.type);
            report.changed.push({ key, type: def.type, cell: control.index });
          }
        }
      }
      report.editable++;
      report.editableTypes[def.type] = (report.editableTypes[def.type] || 0) + 1;
    }
    await page.click('#mobile-next');
  }
  assert.equal(report.editable + report.skipped.length, report.total);
  report.skipCounts = Object.fromEntries([...new Set(report.skipped.map(item => item.category))].map(category => [category, report.skipped.filter(item => item.category === category).length]));
  return report;
}
