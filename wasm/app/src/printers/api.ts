import { BambuApi } from './bambu';
import { BambuCloudApi } from './bambuCloud';
import { CrealityCloudApi } from './crealityCloud';
import { FlashforgeApi } from './flashforge';
import { MoonrakerApi } from './moonraker';
import { OctoPrintApi, PrusaConnectApi, PrusaLinkApi } from './octoprint';
import type { PhysicalPrinter, PrinterApi } from './types';

export function createPrinterApi(printer: PhysicalPrinter): PrinterApi {
  switch (printer.host_type) {
    case 'moonraker': return new MoonrakerApi(printer);
    case 'prusalink': return new PrusaLinkApi(printer);
    case 'prusaconnect': return new PrusaConnectApi(printer);
    case 'octoprint': return new OctoPrintApi(printer);
    case 'bambu': return new BambuApi(printer);
    case 'bambu-cloud': return new BambuCloudApi(printer);
    case 'creality-cloud': return new CrealityCloudApi(printer);
    case 'flashforge': return new FlashforgeApi(printer);
  }
}
