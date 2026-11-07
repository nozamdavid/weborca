import type { Heater, HostType, PrinterFilamentSlot } from './types';

export interface DeviceExtruderReading {
  id: string;
  toolIndex?: number;
  heater?: Heater;
  filament?: PrinterFilamentSlot;
}

const physicalIndex = (index: number | undefined): index is number =>
  index !== undefined && Number.isInteger(index) && index >= 0 && index <= 15;

export function deviceExtruderReadings(hostType: HostType, heaters: Heater[], slots: PrinterFilamentSlot[] | undefined): {
  extruders: DeviceExtruderReading[];
  remainingHeaters: Heater[];
  remainingFilamentSlots: PrinterFilamentSlot[] | undefined;
} {
  const extruders: DeviceExtruderReading[] = heaters.filter(h => h.kind === 'extruder').map(heater => ({
    id: heater.id, heater, ...(physicalIndex(heater.toolIndex) ? { toolIndex: heater.toolIndex } : {})
  }));
  const remainingHeaters = heaters.filter(h => h.kind !== 'extruder');
  if (hostType !== 'snapmaker-cloud') return { extruders, remainingHeaters, remainingFilamentSlots: slots };

  const heaterCounts = new Map<number, number>();
  const slotCounts = new Map<number, number>();
  for (const reading of extruders) if (reading.toolIndex !== undefined)
    heaterCounts.set(reading.toolIndex, (heaterCounts.get(reading.toolIndex) ?? 0) + 1);
  for (const slot of slots ?? []) if (physicalIndex(slot.slotIndex))
    slotCounts.set(slot.slotIndex, (slotCounts.get(slot.slotIndex) ?? 0) + 1);

  const remainingFilamentSlots = slots?.filter(slot => {
    if (!physicalIndex(slot.slotIndex)) return true;
    const toolIndex = slot.slotIndex;
    const reading = heaterCounts.get(toolIndex) === 1 && slotCounts.get(toolIndex) === 1
      ? extruders.find(item => item.toolIndex === toolIndex) : undefined;
    if (reading) reading.filament = slot;
    else extruders.push({ id: `filament:${slot.id}`, toolIndex, filament: slot });
    return false;
  });
  extruders.sort((a, b) => (a.toolIndex ?? Infinity) - (b.toolIndex ?? Infinity));
  return { extruders, remainingHeaters, remainingFilamentSlots };
}
