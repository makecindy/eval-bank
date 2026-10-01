export const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
export const TEMP_DIR_RE = /(^|[\\/])(tmp|temp)([\\/])|[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i;
export function isPathCandidate(raw) {
    const s = raw.trim();
    if (s.length < 3 || s.length > 512)
        return false;
    if (!EXT_RE.test(s) && !/[\\/]$/.test(s))
        return false;
    if (TEMP_DIR_RE.test(s))
        return false;
    const isAbs = /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/');
    const hasSep = s.includes('/') || s.includes('\\');
    return isAbs || hasSep;
}
export function extractCommandArguments(text, offset = 0) {
    const parsed = [...text.matchAll(/'([^'\r\n]*)'|"([^"\r\n]*)"|([^\s]+)/g)].map((match) => {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        const quoted = match[1] !== undefined || match[2] !== undefined;
        const quoteOffset = quoted ? 1 : 0;
        const start = offset + (match.index ?? 0) + quoteOffset;
        return { value, start, end: start + value.length, quoted };
    });
    const merged = [];
    for (const argument of parsed) {
        const previous = merged.at(-1);
        const trailingBackslashes = previous?.value.match(/\\+$/)?.[0].length ?? 0;
        if (previous && !previous.quoted && !argument.quoted && trailingBackslashes % 2 === 1) {
            const gap = text.slice(previous.end - offset, argument.start - offset);
            if (/^[ \t]+$/.test(gap)) {
                previous.value = `${previous.value.slice(0, -1)}${gap[0]}${argument.value}`;
                previous.end = argument.end;
                continue;
            }
        }
        merged.push(argument);
    }
    return merged.map(({ value, start, end }) => ({ value, start, end }));
}
export const RELATIVE_PATH_TOKEN_RE = /(?:^|[\s=(,>])([^\s'"<>|?*]+[\\/])(?=$|[\s'"<>|])/g;
export const EXPLICIT_OUTPUT_RELATIVE_TOKEN_RE = /(?:(?:^|\s)(?:-o|--output(?:-file|-document)?|--outfile)(?:\s+|=)|>{1,2}\s*)([^\s'"<>|?*=]+[\\/][^\s'"<>|?*]*)(?=$|[\s'"<>|;&])/g;
export function extractCommandPathTokens(command) {
    if (!command)
        return [];
    const out = [];
    const quotedRanges = [];
    const push = (raw, start, end) => {
        const s = raw.trim();
        if (!isPathCandidate(s))
            return;
        out.push({ path: s, start, end });
    };
    const scanQuoted = (re) => {
        for (const m of command.matchAll(re)) {
            const raw = m[1] ?? '';
            const matchStart = m.index ?? 0;
            quotedRanges.push({ start: matchStart, end: matchStart + m[0].length });
            push(raw, matchStart + 1, matchStart + 1 + raw.length);
        }
    };
    scanQuoted(/'([^'\r\n]+)'/g);
    scanQuoted(/"([^"\r\n]+)"/g);
    const insideQuotedRange = (index) => quotedRanges.some((range) => index >= range.start && index < range.end);
    for (const m of command.matchAll(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s'"<>|?*]+/g)) {
        const start = m.index ?? 0;
        if (!insideQuotedRange(start))
            push(m[0], start, start + m[0].length);
    }
    for (const m of command.matchAll(/(?:^|[\s=(,>])(\/[^\s'"<>|?*:]+)/g)) {
        const start = (m.index ?? 0) + m[0].length - m[1].length;
        if (!insideQuotedRange(start))
            push(m[1], start, start + m[1].length);
    }
    for (const m of command.matchAll(RELATIVE_PATH_TOKEN_RE)) {
        const raw = m[1];
        const start = (m.index ?? 0) + m[0].length - raw.length;
        if (!insideQuotedRange(start) && !/^https?:\/\//i.test(raw)) {
            push(raw, start, start + raw.length);
        }
    }
    for (const m of command.matchAll(EXPLICIT_OUTPUT_RELATIVE_TOKEN_RE)) {
        const raw = m[1] ?? '';
        const start = (m.index ?? 0) + m[0].length - raw.length;
        if (!insideQuotedRange(start) && !/^https?:\/\//i.test(raw)) {
            push(raw, start, start + raw.length);
        }
    }
    for (const token of extractTransferPlainFilenameDestinations(command)) {
        out.push(token);
    }
    const seenRanges = new Set();
    return out
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .filter((token) => {
        const key = `${token.start}:${token.end}:${token.path}`;
        if (seenRanges.has(key))
            return false;
        seenRanges.add(key);
        return true;
    });
}
export const WRITE_CALL_PREFIX_RE = /(?:\.|\b)(?:save|savefig|writeFileSync|writeFile|writeAllText|writeAllBytes|createWriteStream|write_text|write_bytes|to_csv|to_excel|to_json|to_parquet|imwrite|imsave|dump)\s*\(\s*(?:(?:path_or_buf|excel_writer|path|filename|fname|fp|file)\s*=\s*)?(?:[rubf]{0,2})?['"]$/i;
export const WRITE_CALL_LATER_KEYWORD_PREFIX_RE = /(?:\.|\b)(?:save|savefig|writeFileSync|writeFile|writeAllText|writeAllBytes|createWriteStream|write_text|write_bytes|to_csv|to_excel|to_json|to_parquet|imwrite|imsave|dump)\s*\(\s*[^();\r\n]+,\s*(?:path_or_buf|excel_writer|path|filename|fname|fp|file)\s*=\s*(?:[rubf]{0,2})?['"]$/i;
export const OBJECT_FIRST_WRITE_CALL_PREFIX_RE = /\b(?:torch\.save|joblib\.dump)\s*\(\s*(?:[^();\r\n]|\([^()]*\))+,\s*(?:[rubf]{0,2})?['"]$/i;
export const POWERSHELL_CMDLET_RE = /\b[A-Za-z][A-Za-z0-9]*-[A-Za-z][A-Za-z0-9-]*\b/g;
export const POWERSHELL_WRITE_COMMANDS = new Set([
    'out-file',
    'set-content',
    'add-content',
    'export-csv',
    'export-clixml',
    'new-item',
]);
export const OUTPUT_OPTION_PREFIX_RE = /(?:^|\s)(?:-o|--output(?:-file|-document)?|--outfile)(?:\s+|=)['"]?$/i;
export const REDIRECT_PREFIX_RE = /(?:^|[^>])>{1,2}\s*['"]?$/;
export const SAVE_COMMAND_PREFIX_RE = /(?:^|[;&|]\s*|\s)save\s+['"]?$/i;
export const TEE_COMMAND_PREFIX_RE = /(?:^|[|;&]\s*)tee(?:\.exe)?\b[^|;&\r\n]*['"]?$/i;
export function extractTransferPlainFilenameDestinations(command) {
    const out = [];
    const commandRe = /\b(Copy-Item|Move-Item|copy|move|cp|mv)\b([^|;\r\n]*?)(?=\|{1,2}|;|\r?$|\n)/gim;
    for (const commandMatch of command.matchAll(commandRe)) {
        const commandName = (commandMatch[1] ?? '').toLowerCase();
        const argsText = commandMatch[2] ?? '';
        const argsStart = (commandMatch.index ?? 0) + commandMatch[0].length - argsText.length;
        const args = extractCommandArguments(argsText, argsStart);
        const isPlainFilename = (value) => EXT_RE.test(value) && !/[\\/<>|?*]/.test(value);
        if (commandName !== 'copy-item' && commandName !== 'move-item') {
            const supportsTargetDirectoryOption = commandName === 'cp' || commandName === 'mv';
            const targetDirectoryOptionIndex = supportsTargetDirectoryOption
                ? args.findIndex((arg) => /^(?:-t|--target-directory(?:=|$))/i.test(arg.value))
                : -1;
            if (targetDirectoryOptionIndex >= 0) {
                const option = args[targetDirectoryOptionIndex];
                const equalsIndex = option.value.indexOf('=');
                const separateDestination = args[targetDirectoryOptionIndex + 1];
                const rawDestination = equalsIndex >= 0 ? option.value.slice(equalsIndex + 1) : separateDestination?.value;
                const destinationStart = equalsIndex >= 0
                    ? option.start + equalsIndex + 1
                    : (separateDestination?.start ?? option.end);
                const destination = rawDestination?.replace(/^(['"])(.*)\1$/, '$2');
                if (destination && !TEMP_DIR_RE.test(destination) && !/[<>|?*]/.test(destination)) {
                    out.push({
                        path: /[\\/]$/.test(destination) ? destination : `${destination}/`,
                        start: destinationStart,
                        end: destinationStart + destination.length,
                    });
                }
                continue;
            }
            const positional = args.filter((arg) => !arg.value.startsWith('-') &&
                !((commandName === 'copy' || commandName === 'move') && /^\/[A-Za-z]+$/.test(arg.value)));
            const destination = positional.length >= 2 ? positional.at(-1) : undefined;
            if (destination && isPlainFilename(destination.value)) {
                out.push({ path: destination.value, start: destination.start, end: destination.end });
            }
            continue;
        }
        const explicitDestinationIndex = args.findIndex((arg) => /^-(?:Destination|LiteralDestination|Target)$/i.test(arg.value));
        if (explicitDestinationIndex >= 0) {
            const destination = args[explicitDestinationIndex + 1];
            if (destination && isPlainFilename(destination.value)) {
                out.push({ path: destination.value, start: destination.start, end: destination.end });
            }
            continue;
        }
        const positional = [];
        let namedSource = false;
        for (let index = 0; index < args.length; index += 1) {
            const arg = args[index];
            if (!arg.value.startsWith('-')) {
                positional.push(arg);
                continue;
            }
            if (/^-(?:Path|LiteralPath)$/i.test(arg.value))
                namedSource = true;
            if (!/^-(?:Force|Recurse|PassThru|Container|Confirm|WhatIf)$/i.test(arg.value)) {
                index += 1;
            }
        }
        const destination = namedSource ? positional[0] : positional[1];
        if (destination && isPlainFilename(destination.value)) {
            out.push({ path: destination.value, start: destination.start, end: destination.end });
        }
    }
    return out;
}
export function isTopLevelPowerShellTail(value) {
    let depth = 0;
    let quote = null;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === '`') {
            index += 1;
            continue;
        }
        if (quote) {
            if (char === quote)
                quote = null;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ')' || char === ']' || char === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && (char === ';' || char === '|' || char === '\r' || char === '\n')) {
            return false;
        }
    }
    return depth === 0;
}
export function isPowerShellOutputPosition(before) {
    const cmdlets = [...before.matchAll(POWERSHELL_CMDLET_RE)];
    const lastCmdlet = cmdlets.at(-1);
    const lastWriteCmdlet = cmdlets
        .filter((match) => POWERSHELL_WRITE_COMMANDS.has(match[0].toLowerCase()))
        .at(-1);
    if (!lastCmdlet || !lastWriteCmdlet)
        return false;
    const writeTail = before.slice((lastWriteCmdlet.index ?? 0) + lastWriteCmdlet[0].length);
    if (/-(?:FilePath|LiteralPath|Path)\s+['"]?$/i.test(writeTail) &&
        isTopLevelPowerShellTail(writeTail)) {
        return true;
    }
    if (lastCmdlet.index !== lastWriteCmdlet.index)
        return false;
    const trailing = before.slice((lastCmdlet.index ?? 0) + lastCmdlet[0].length);
    return /^\s*['"]?$/.test(trailing);
}
export function isExplicitOutputPath(command, token, tokens) {
    const before = command.slice(Math.max(0, token.start - 240), token.start);
    const powerShellBefore = command.slice(0, token.start);
    const after = command.slice(token.end, token.end + 80);
    if (WRITE_CALL_PREFIX_RE.test(before) ||
        WRITE_CALL_LATER_KEYWORD_PREFIX_RE.test(before) ||
        OBJECT_FIRST_WRITE_CALL_PREFIX_RE.test(before) ||
        /^\s*['"]?\s*\)\s*\.\s*write_(?:text|bytes)\s*\(/i.test(after) ||
        isPowerShellOutputPosition(powerShellBefore) ||
        OUTPUT_OPTION_PREFIX_RE.test(before) ||
        REDIRECT_PREFIX_RE.test(before) ||
        SAVE_COMMAND_PREFIX_RE.test(before) ||
        TEE_COMMAND_PREFIX_RE.test(before)) {
        return true;
    }
    if (/\bopen\s*\(\s*(?:[rubf]{0,2})?['"]$/i.test(before) &&
        (/^['"]\s*,\s*['"][wax][bt+]*['"]/i.test(after) ||
            /^['"]\s*,\s*[^();\r\n]*\bmode\s*=\s*['"][wax][bt+]*['"]/i.test(after))) {
        return true;
    }
    const previousSeparators = [
        { index: command.lastIndexOf(';', token.start - 1), length: 1 },
        { index: command.lastIndexOf('\n', token.start - 1), length: 1 },
        { index: command.lastIndexOf('&&', token.start - 1), length: 2 },
        { index: command.lastIndexOf('||', token.start - 1), length: 2 },
    ];
    const previousSeparator = previousSeparators.reduce((latest, candidate) => candidate.index > latest.index ? candidate : latest);
    const segmentStart = previousSeparator.index + previousSeparator.length;
    const nextSeparators = [
        command.indexOf(';', token.end),
        command.indexOf('\n', token.end),
        command.indexOf('&&', token.end),
        command.indexOf('||', token.end),
    ].filter((index) => index >= 0);
    const segmentEnd = nextSeparators.length > 0 ? Math.min(...nextSeparators) : command.length;
    const segment = command.slice(segmentStart, segmentEnd);
    const lastPath = tokens
        .filter((candidate) => candidate.start >= segmentStart && candidate.end <= segmentEnd)
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .at(-1);
    const beforeInSegment = command.slice(segmentStart, token.start);
    if (/(?:^|\|\s*)(?:Copy-Item|Move-Item)\b/i.test(segment.trim())) {
        const hasExplicitDestination = /-(?:Destination|LiteralDestination|Target)\s+/i.test(segment);
        if (hasExplicitDestination) {
            return /-(?:Destination|LiteralDestination|Target)\s+['"]?$/i.test(beforeInSegment);
        }
        return lastPath?.start === token.start && lastPath.end === token.end;
    }
    const isTargetDirectoryTransfer = /(?:^|\|\s*)(?:cp|mv)\s+/i.test(segment.trim()) &&
        /(?:^|\s)(?:-t(?:\s+|$)|--target-directory(?:\s+|=))/i.test(segment);
    if (isTargetDirectoryTransfer) {
        return /(?:^|\s)(?:-t|--target-directory)(?:\s+|=)['"]?$/i.test(beforeInSegment);
    }
    return (lastPath?.start === token.start &&
        lastPath.end === token.end &&
        /(?:^|\|\s*)(?:cp|copy|mv|move|Copy-Item|Move-Item)\s+/i.test(segment.trim()));
}
export function transferDirectoryOutputs(command, destination, tokens) {
    if (!/[\\/]$/.test(destination.path))
        return [destination.path];
    const previousSeparators = [
        { index: command.lastIndexOf(';', destination.start - 1), length: 1 },
        { index: command.lastIndexOf('\n', destination.start - 1), length: 1 },
        { index: command.lastIndexOf('&&', destination.start - 1), length: 2 },
        { index: command.lastIndexOf('||', destination.start - 1), length: 2 },
    ];
    const previousSeparator = previousSeparators.reduce((latest, candidate) => candidate.index > latest.index ? candidate : latest);
    const segmentStart = previousSeparator.index + previousSeparator.length;
    const nextSeparators = [
        command.indexOf(';', destination.end),
        command.indexOf('\n', destination.end),
        command.indexOf('&&', destination.end),
        command.indexOf('||', destination.end),
    ].filter((index) => index >= 0);
    const segmentEnd = nextSeparators.length > 0 ? Math.min(...nextSeparators) : command.length;
    const sourcePaths = tokens
        .filter((token) => token.start >= segmentStart && token.end <= segmentEnd)
        .filter((token) => token.start !== destination.start)
        .filter((token) => !/[\\/]$/.test(token.path))
        .map((token) => token.path);
    const segmentArguments = extractCommandArguments(command.slice(segmentStart, segmentEnd), segmentStart);
    for (const argument of segmentArguments) {
        if (argument.start === destination.start)
            continue;
        if (!EXT_RE.test(argument.value) || /[<>|?*]/.test(argument.value))
            continue;
        if (!sourcePaths.includes(argument.value))
            sourcePaths.push(argument.value);
    }
    const outputs = sourcePaths
        .map((source) => {
        const sourceName = source
            .replace(/[\\/]$/, '')
            .split(/[\\/]/)
            .at(-1);
        return sourceName ? `${destination.path}${sourceName}` : null;
    })
        .filter((path) => Boolean(path));
    return outputs.length > 0 ? outputs : [destination.path];
}
export const HEADLESS_BROWSER_OUTPUT_RE = /--(?:print-to-pdf|screenshot)=(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'<>|]+))/gi;
export const LIBREOFFICE_EXEC_RE = /^(?:soffice(?:\.bin)?|libreoffice)(?:\.(?:exe|com))?$/i;
export const POSITIONAL_OUTPUT_EXEC_RE = /^(?:wkhtmltopdf|wkhtmltoimage|weasyprint)(?:\.exe)?$/i;
export function splitCommandSegments(command) {
    return command.split(/;|\r?\n|&&|\|\||\|/g);
}
export function commandArgumentBasename(value) {
    const unquoted = value.replace(/^(['"])(.*)\1$/, '$2');
    const tail = unquoted.split(/[\\/]/).at(-1);
    return (tail ?? unquoted).toLowerCase();
}
export function fileStem(value) {
    const name = value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? value;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}
export function isSynthesizedOutputCandidate(value) {
    const s = value.trim();
    if (s.length < 3 || s.length > 512)
        return false;
    if (!EXT_RE.test(s))
        return false;
    if (TEMP_DIR_RE.test(s))
        return false;
    return !/[<>|?*]/.test(s);
}
export function libreOfficeConvertOutputs(args) {
    const execIndex = args.findIndex((arg) => LIBREOFFICE_EXEC_RE.test(commandArgumentBasename(arg)));
    if (execIndex < 0)
        return [];
    let convertTo = null;
    let outDir = null;
    const inputs = [];
    for (let index = execIndex + 1; index < args.length; index += 1) {
        const arg = args[index] ?? '';
        if (!arg.startsWith('-')) {
            if (EXT_RE.test(arg))
                inputs.push(arg);
            continue;
        }
        const equalsIndex = arg.indexOf('=');
        const name = (equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg).replace(/^-+/, '').toLowerCase();
        const inline = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : null;
        if (name !== 'convert-to' && name !== 'outdir')
            continue;
        const value = inline ?? args[index + 1] ?? null;
        if (inline === null)
            index += 1;
        if (name === 'convert-to')
            convertTo = value;
        else
            outDir = value;
    }
    if (!convertTo || inputs.length === 0)
        return [];
    const ext = (convertTo.split(':')[0] ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext))
        return [];
    const dir = outDir ? (/[\\/]$/.test(outDir) ? outDir : `${outDir}/`) : '';
    return inputs.map((input) => `${dir}${fileStem(input)}.${ext}`);
}
export function positionalConverterOutputs(args) {
    const execIndex = args.findIndex((arg) => POSITIONAL_OUTPUT_EXEC_RE.test(commandArgumentBasename(arg)));
    if (execIndex < 0)
        return [];
    const positionals = args.slice(execIndex + 1).filter((arg) => !arg.startsWith('-'));
    if (positionals.length < 2)
        return [];
    const output = positionals.at(-1);
    return output ? [output] : [];
}
export function extractConverterOutputPaths(command) {
    if (!command)
        return [];
    const out = [];
    for (const match of command.matchAll(HEADLESS_BROWSER_OUTPUT_RE)) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (value)
            out.push(value);
    }
    for (const segment of splitCommandSegments(command)) {
        const args = extractCommandArguments(segment)
            .map((argument) => argument.value)
            .filter((value) => value.length > 0);
        if (args.length === 0)
            continue;
        out.push(...libreOfficeConvertOutputs(args), ...positionalConverterOutputs(args));
    }
    return out.filter((value) => isSynthesizedOutputCandidate(value));
}
export function extractCommandOutputPathCandidates(command) {
    const tokens = extractCommandPathTokens(command);
    const seen = new Set();
    const out = [];
    for (const token of tokens) {
        if (!isExplicitOutputPath(command, token, tokens))
            continue;
        for (const output of transferDirectoryOutputs(command, token, tokens)) {
            if (seen.has(output))
                continue;
            seen.add(output);
            out.push(output);
        }
    }
    for (const output of extractConverterOutputPaths(command)) {
        if (seen.has(output))
            continue;
        seen.add(output);
        out.push(output);
    }
    return out;
}
