/* Replaces OCCT's Resource_ConvertUnicode.c in the wasm STEP module.
 *
 * The original holds four 128 KB lookup tables (Shift-JIS, EUC-JP via Shift-JIS, GB2312) that are only
 * read when a STEP file declares one of those legacy code pages. STEP files reach the module as UTF-8 or
 * with \X2\ escapes. With this stub those code pages map every double-byte character to U+0000.
 * Linked as an object before libTKernel.a, so the archive member with the real tables is not extracted.
 */

void Resource_sjis_to_unicode(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}

void Resource_unicode_to_sjis(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}

void Resource_unicode_to_euc(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}

void Resource_euc_to_unicode(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}

void Resource_gb_to_unicode(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}

void Resource_unicode_to_gb(unsigned int* ph, unsigned int* pl)
{
    *ph = 0;
    *pl = 0;
}
