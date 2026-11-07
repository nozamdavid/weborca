import { BambuApi } from './bambu';
import { OctoEverywhereApi } from './octoEverywhere';
import { BambuCloudApi } from './bambuCloud';
import { CrealityCloudApi } from './crealityCloud';
import { SnapmakerCloudApi } from './snapmakerCloud';
import { FlashforgeApi } from './flashforge';
import { MoonrakerApi } from './moonraker';
import { OctoPrintApi, PrusaConnectApi, PrusaLinkApi } from './octoprint';
import type { PhysicalPrinter, PrinterApi } from './types';

export function createPrinterApi(printer: PhysicalPrinter): PrinterApi {
  printer = { ...printer, use_gateway: true };
  if (printer.octoeverywhere?.mode === 'remote') {
    return new OctoEverywhereApi(printer);
  }
  switch (printer.host_type) {
    case 'moonraker': return new MoonrakerApi(printer);
    case 'prusalink': return new PrusaLinkApi(printer);
    case 'prusaconnect': return new PrusaConnectApi(printer);
    case 'octoprint': return new OctoPrintApi(printer);
    case 'bambu': return new BambuApi(printer);
    case 'bambu-cloud': return new BambuCloudApi(printer);
    case 'creality-cloud': return new CrealityCloudApi(printer);
    case 'snapmaker-cloud': return new SnapmakerCloudApi(printer);
    case 'flashforge': return new FlashforgeApi(printer);
  }
}
