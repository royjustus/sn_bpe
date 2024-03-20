import {

gs,
GlideSysAttachment,
GlideRecord,
GlideTextReader
} from '@servicenow/glide';

import { TextEncoderPolyfill } from './UTF8Polyfill.js';
export const TextEncoder = TextEncoderPolyfill;

export type MergeDict = { [key: string]: number };
export type TokenVocabulary = { [key: string]: number };
export type OrderedTokenVocabulary =  [key: string, value: number][];
export type CharVocabulary = { [key: string]: string };


/**
 * Represents a tokenizer used for tokenization and text processing.
 */
export class Tokenizer {

private TOKENIZER_TABLE_NAME: string = 'x_13131_bpe_tokenizer';
private TOKENIZER_FILE_NOT_FOUND: string = 'No attachment found for the given tokenizer ID';
private TOKENIZER_NOT_FOUND: string = 'Tokenizer record not found';
private TOKINIZER_ID_NOT_VALID: string = 'Tokenizer ID is not a valid GUID or GlideRecord object';
private tokenizerConfigRawString: string | null = null;

public pattern: string | null = null;
private compiledPattern: RegExp | null = null;

public merges: MergeDict | null = null;
public vocabulary: CharVocabulary | null = null;
public byteShuffle: number[] = [];
public inverseByteShuffle: number[] = [];
public specialTokens: { [key: string]: number } = {};
public inverseSpecialTokens: { [key: number]: string } = {};

public logLevel: 0 | 1 | 2 = 0;

private info(message: string): void {
    if (this.logLevel > 0) {
        gs.info(message);
    }
}

private warning(message: string): void {
    if (this.logLevel > 1) {
        gs.warn(message);
    }
}

private error(message: string): void {
    throw new Error(message)
}



/**
 * Loads a tokenizer from either a string or a GlideRecord.
 * @param tokenizer - The tokenizer to load, either a string or a GlideRecord.
 * @param logLevel - The log level to use. 0 for no logging, 1 for info logging, 2 for warning logging.
 * @param ignoreCache - Whether to force a refresh of the tokenizer.
 * @returns An object containing the loaded tokenizer information, or null if there was an error.
 */
public constructor(tokenizer: string | GlideRecord, logLevel: 0 | 1 | 2 = 0, ignoreCache: boolean = false) {

    this.logLevel = logLevel;

    try {
        this.loadTokenizerProperties(tokenizer);
    }
    catch (e) {
        this.error("Error Loading Tokenizer Properties: " + e);
    }

    let cacheAttachment: GlideRecord | null = null;
    
    try{
        cacheAttachment = this.getTokenizerCachedConfig(tokenizer);
    }
    catch (e) {
        this.error("Error Retrieving Cached Tokenizer: " + e);
    }
    
    if (ignoreCache || (cacheAttachment == null)) {
        try {
            this.generateTokenizer(tokenizer);
            if(!ignoreCache)
            {
                this.saveTokenizerCachedConfig(tokenizer, {merges: this.merges, vocabulary: this.vocabulary, byteShuffle: this.byteShuffle, inverseByteShuffle: this.inverseByteShuffle});
            }
        } catch (e) {
            this.error("Error Generating Tokenizer: " + e);
        }
    } else {

        try {
            const tokenizerConfigRawStream = this.extractFileStream(cacheAttachment);
            this.tokenizerConfigRawString = this.streamToString(tokenizerConfigRawStream);
        } catch (e) {
            this.error("Error Loading Cached Tokenizer: " + e);
        }

        try {
            this.info("Retrieved Cached Tokenizer: " + cacheAttachment.getLink(true));
            const tokenizerConfig = JSON.parse(this.tokenizerConfigRawString);
            this.merges = tokenizerConfig.merges;
            this.vocabulary = tokenizerConfig.vocabulary;
            this.byteShuffle = tokenizerConfig.byteShuffle;
            this.inverseByteShuffle = tokenizerConfig.inverseByteShuffle;
        } catch (e) {
            this.error("Error Parsing Cached Tokenizer: " + e);
        }
    }



}

/**
 * Generates a tokenizer from either a string or a GlideRecord.
 * @param tokenizer - The tokenizer to generate, either a string or a GlideRecord.
 * @returns An object containing the generated tokenizer information, or null if there was an error.
 */
private generateTokenizer(tokenizer: string | GlideRecord): void {
    let attachment: GlideRecord | null = null; ;
    // Retrieve the tokenizer attachment
    try {
        attachment = this.getTokenizerAttachment(tokenizer);
        if (!attachment) {
            return null;
        }
    } catch (e) {
        this.error("Error Retrieving Tokenizer Attachment: " + e);
    }

    // Extract the vocabulary and vocabulary array from the stream
    let vocabulary: TokenVocabulary | null = null;
    let vocabularyArray: OrderedTokenVocabulary | null = null;

    try {
        let stream: Object | null = null;
        stream = this.extractFileStream(attachment);
        const tokenizer = this.getTokenizerFromStream(stream);
        vocabulary = tokenizer.vocabulary;
        vocabularyArray = tokenizer.vocabularyArray;

    } catch (e) {
        this.error("Error Extracting Vocabulary: " + e);
    }

    // Recover the merges from the vocabulary array and vocabulary
    try {
        this.merges = this.recoverMerges(vocabularyArray, vocabulary);
    }
    catch (e) {
        this.error("Error Recovering Merges: " + e);
    }

    try {
        for (let i = 0; i < 256; i++) {
            const binaryQuery = Buffer.from([i]);
            const charQuery = binaryQuery.toString('binary');
            const val = vocabulary[charQuery];
            this.byteShuffle[i] = val;
            this.inverseByteShuffle[val] = i;
        }

        this.info(`Byte Shuffle: ${JSON.stringify(this.byteShuffle)}`);
        this.info(`Inverse Byte Shuffle: ${JSON.stringify(this.inverseByteShuffle)}`);
    }
    catch (e) {
        this.error("Error Creating Byte Mappings: " + e);
    }

    // Create the vocabulary from the merges
    try {
        this.vocabulary = this.createShortVocab(this.merges);
    }
    catch (e) {
        this.error("Error Creating Short Vocabulary: " + e);
        return null;
    }
}

/**
 * Runs a callback on an attachment if the file extension matches the given extension.
 * @param attachment 
 * @param extension 
 * @param callback 
 * @returns 
 */
private runOnAttatchmentsIfExtensionMatches(attachment: GlideRecord, extension: string, callback: (attachment: GlideRecord) => void): void {
    if (attachment.getValue('file_name').indexOf(extension) != -1) {
        return callback(attachment);
    }
    else {
        return null;
    }
}

/**
 * Retrieves the tokenizer attachment from the database.
 * @param tokenizer - The tokenizer to retrieve the attachment for.
 * @returns The tokenizer attachment, or null if there was an error.
 */
private getTokenizerAttachment(tokenizer: string | GlideRecord): GlideRecord | null {
    const tokenizerId: string | null = this.validateTokenizer(tokenizer);
    if (!tokenizerId) return null;

    const GSA: GlideSysAttachment = new GlideSysAttachment();
    const attachment: GlideRecord = GSA.getAttachments(this.TOKENIZER_TABLE_NAME, tokenizerId);
    let returnAttachment: GlideRecord | null = null;
    while (attachment.next()) {
        this.runOnAttatchmentsIfExtensionMatches(attachment, '.tiktoken.txt', (attachment: GlideRecord) => {
            returnAttachment = attachment;
        });
        if (returnAttachment != null) return returnAttachment;
    }
    this.error(this.TOKENIZER_FILE_NOT_FOUND);
    return null;
}

/**
 * Retrieves the cached tokenizer configuration from the database.
 * @param tokenizer - The tokenizer to retrieve the cached configuration for.
 * @returns The cached tokenizer configuration, or null if there was an error.
 */
private getTokenizerCachedConfig(tokenizer: string | GlideRecord): GlideRecord | null {
    const tokenizerId: string | null = this.validateTokenizer(tokenizer);
    if (!tokenizerId) return null;

    const GSA: GlideSysAttachment = new GlideSysAttachment();
    const attachment: GlideRecord = GSA.getAttachments(this.TOKENIZER_TABLE_NAME, tokenizerId);
    let returnAttachment: GlideRecord | null = null;
    while (attachment.next()) {
        this.runOnAttatchmentsIfExtensionMatches(attachment, '.cache.text', (attachment: GlideRecord) => {
            returnAttachment = attachment;
        });
        if (returnAttachment != null) return returnAttachment;
    }
    return null;
}
/** 
 * Extracts the file stream from an attachment.
 * @param attachment - The attachment to extract the file stream from.
 * @returns The file stream, or null if there was an error.
 * */
private extractFileStream(attachment: GlideRecord): Object | null {
    if (!attachment) return null;
    const GSA: GlideSysAttachment = new GlideSysAttachment();
    const stream: Object = GSA.getContentStream(attachment.getUniqueValue());

    return stream;
}

/**
 * 
 * @param tokenizer The tokenizer to load, either a string or a GlideRecord.
 * @returns null
 */
private loadTokenizerProperties(tokenizer: string | GlideRecord): string | null {
    const tokenizerId: string | null = this.validateTokenizer(tokenizer);
    if (!tokenizerId) return null;

    const tokenizerRecord: GlideRecord = new GlideRecord('x_13131_bpe_tokenizer');
    const found: boolean = tokenizerRecord.get("sys_id", tokenizerId);

    if (!found) {
        throw this.TOKENIZER_NOT_FOUND + " ID:" + tokenizerId + " not found. ";
    }
    
    const specialTokensJson: string = tokenizerRecord.getValue('special_tokens');
    try {
        this.specialTokens = JSON.parse(specialTokensJson) as { [key: string]: number };
    } catch (e) {
       this.error('Error parsing special tokens JSON: ' + e);
    }
    const pattern: string = tokenizerRecord.getValue('pattern_string');
    try{
        this.setPattern(pattern);
    }
    catch (e) {
        this.error('Error loading or parsing RegEx pattern "'+ pattern +'" from tokenizer record: ' + e);
    }
}

/**
 * Performs Byte Pair Encoding (BPE) on the given token using the specified vocabulary.
 * 
 * BPE is a tokenization method that iteratively merges the most frequent pair of adjacent
 * characters or character sequences based on a predefined ranking within the vocabulary,
 * until no more pairs can be merged or the rank of merges exceeds the specified `maxRank`.
 *
 * @param {TokenVocabulary} vocabulary - A mapping from token pairs to their ranks which dictates the merge operations.
 * @param {string} token - The string token to be tokenized using BPE.
 * @param {number} maxRank - The maximum rank for a merge operation to be considered. If a pair's rank is higher, the merge is not performed.
 * @returns {string[]} An array of string parts representing the token after applying BPE merges up to the specified `maxRank`.
 */
private bpe(vocabulary: TokenVocabulary, token: string, maxRank: number): string[] {
    const parts: string[] = Array.from(token);
    while (true) {
        let minIdx: number | null = null;
        let minRank: number | null = null;
        for (let i = 0; i < parts.length - 1; i++) {
            const pair = parts[i] + parts[i + 1];
            const rank = vocabulary[pair];
            if (rank !== undefined && (minRank === null || rank < minRank)) {
                minIdx = i;
                minRank = rank;
            }
        }
        if (minRank === null || (maxRank !== null && minRank >= maxRank)) {
            break;
        }

        parts.splice(minIdx, 2, parts[minIdx] + parts[minIdx + 1]);
    }
    return parts;
}

/**
 * Recovers the merges from the vocabulary array and vocabulary. Provides both an array guaranteed to be in the right order and a dictionary for quick lookups.
 * @param vocabularyArray Ordered Array of Tokens
 * @param vocabulary  Dictionary mapping tokens to their rank
 * @returns 
 */
private recoverMerges(vocabularyArray: OrderedTokenVocabulary, vocabulary: TokenVocabulary): MergeDict {
    const merges: MergeDict = {};
    for (let i = 0; i < vocabularyArray.length; i++) {
        const token: string = vocabularyArray[i][0];
        const rank: number = vocabularyArray[i][1];
        if (token.length === 1) {
            continue; // skip raw bytes
        }
        const pair = this.bpe(vocabulary, token, rank);

        if (pair.length !== 2) {
            this.error('Invalid pair length (' + pair.length + ') on ' + token + ' ' + pair + ' >>' + rank);
        }
        const ix0 = vocabulary[pair[0]];
        const ix1 = vocabulary[pair[1]];
        merges[`${ix0},${ix1}`] = rank;
    }
    return merges;
}

/**
 * 
 * @param mergeableRanks Mergable Ranks from the tokenizer to use in extracting the byte vocabulary
 * @returns 
 */
private createShortVocab(mergeableRanks: MergeDict): CharVocabulary {
    const vocab: CharVocabulary = {};
    for (let idx = 0; idx < 256; idx++) {
        vocab[idx.toString()] = String.fromCharCode(idx);
    }
    for (const [pair, idx] of Object.entries(mergeableRanks)) {
        const [p0, p1] = pair.split(',');
        vocab[idx.toString()] = vocab[p0] + vocab[p1];
    }
    return vocab;
}

/**
 * Converts a stream object to a string.
 * 
 * @param stream - The stream object to convert.
 * @returns The string representation of the stream.
 */
private streamToString(stream: Object): string {
    const reader: GlideTextReader = new GlideTextReader(stream);
    let result: string = '';
    let line: string | null = reader.readLine();
    while (line !== null) {
        result += line;
        line = reader.readLine();
    }
    return result;
}

/**
 * Converts a stream object into a dictionary of tokens and their corresponding values.
 * @param stream - The stream object to convert.
 * @returns An object containing the token vocabulary and the ordered token vocabulary array.
 */
private getTokenizerFromStream(stream: Object): { vocabulary: TokenVocabulary; vocabularyArray: OrderedTokenVocabulary } {
    const reader: GlideTextReader = new GlideTextReader(stream);
    let line: string | null = reader.readLine();
    let loadedTokenCount: number = 0;
    let vocabulary: TokenVocabulary = {};
    let vocabularyArray: OrderedTokenVocabulary = [];
    while (line !== null) {
        const [encodedKey, value]: string[] = line.split(' ');
        const buffer = Buffer.from(encodedKey, 'base64');
        const bufString = buffer.toString('binary');
        const chars = bufString;
        vocabulary[chars] = parseInt(value, 10);
        vocabularyArray.push([chars, parseInt(value, 10)]);
        loadedTokenCount++;
        line = reader.readLine();
    }
    this.info("Loaded Token Count: " + loadedTokenCount);
    this.info("Vocabulary: " + JSON.stringify(vocabulary));
    this.info("Vocabulary Array: " + JSON.stringify(vocabularyArray));

    return { vocabulary, vocabularyArray };
}

/**
 * Validates the input to determine if it represents a valid tokenizer identifier or a GlideRecord object
 * corresponding to a tokenizer record. This method checks if the provided argument is a valid GUID string
 * or an instance of GlideRecord, returning the tokenizer's identifier (sys_id) in either case if valid.
 * 
 * Validation steps include:
 * - If the input is a string, it checks against a regular expression to confirm it is a valid GUID.
 * - If the input is an instance of GlideRecord, it assumes the record is valid and returns its unique identifier (sys_id).
 * 
 * This method is designed to ensure the integrity and validity of tokenizer identifiers used in subsequent operations,
 * particularly in environments like ServiceNow where database operations are common.
 *
 * @param {string | GlideRecord} tokenizer - The identifier (sys_id) as a string or a GlideRecord instance
 *                                           representing the tokenizer to be validated.
 * @returns {string | null} The valid sys_id of the tokenizer if validation succeeds, or null if the input
 *                          is neither a valid GUID string nor a GlideRecord instance.
 */
private validateTokenizer(tokenizer: string | GlideRecord): string | null {
    const guidRegex: RegExp = /^[0-9a-f]{32}$/i;

    if (!tokenizer) {
        this.error(this.TOKINIZER_ID_NOT_VALID);
        return null;
    }

    if (typeof tokenizer === 'string' && guidRegex.test(tokenizer)) {
        return tokenizer;
    } else if (tokenizer instanceof GlideRecord) {
        return tokenizer.getUniqueValue();
    } else {
        this.error(this.TOKINIZER_ID_NOT_VALID);
        return null;
    }
}

/**
 * Saves a given tokenizer configuration as an attachment to a tokenizer record in the system. This method
 * first validates the provided tokenizer identifier or record, retrieves the corresponding tokenizer record,
 * and then attaches the serialized tokenizer configuration to it. The attachment is named using the tokenizer's
 * sys_id with a '.cache.text' suffix and uses 'text/plain' as its MIME type.
 *
 * If the tokenizer is specified as a string, it is assumed to be an identifier (sys_id) which is then validated.
 * If the tokenizer is a GlideRecord instance, it directly proceeds with the attachment process.
 *
 * @param {string | GlideRecord} tokenizer - The identifier (sys_id) of the tokenizer or a GlideRecord instance
 *                                           representing the tokenizer for which the configuration is to be saved.
 * @param {object} tokenizerConfig - The tokenizer configuration object that will be serialized to JSON and attached
 *                                   to the tokenizer record.
 * @returns {void} Does not return a value. If the tokenizer cannot be validated or the tokenizer record cannot be found,
 *                 the function logs an error and exits without creating an attachment.
 *
 * Note: This method relies on ServiceNow's GlideRecord for database interactions and GlideSysAttachment for attaching
 * files to records. It's designed to be used within ServiceNow's server-side scripting environment.
 */
private saveTokenizerCachedConfig(tokenizer: string | GlideRecord, tokenizerConfig: object): void {
    const tokenizerId: string | null = this.validateTokenizer(tokenizer);
    if (!tokenizerId) return;

    const tokenizerRecord: GlideRecord = new GlideRecord('x_13131_bpe_tokenizer');
    const found: boolean = tokenizerRecord.get("sys_id", tokenizerId);
    if (!found) {
        this.error(this.TOKENIZER_NOT_FOUND);
    }

    const GSA: GlideSysAttachment = new GlideSysAttachment();
    const attachment: string = GSA.write(tokenizerRecord, tokenizerId + '.cache.text', 'text/plain', JSON.stringify(tokenizerConfig));
    this.info('Saving Cached tokenizer sys_id is: ' + attachment);
}

/**
 * Encodes the given text into an array of numerical IDs, with options to include, exclude,
 * or specifically handle special tokens based on the `allowedSpecial` parameter. This method
 * supports different modes for dealing with special tokens: allowing all, none, a specific list,
 * or none with a raise on detection of a special token in the input text.
 *
 * @param {string} text - The text to be encoded.
 * @param {string[] | "all" | "none" | "none_raise"} [allowedSpecial="none"] - Specifies how special tokens are handled during encoding:
 *  - `"all"`: All special tokens are allowed and will be encoded using their specific IDs.
 *  - `"none"`: No special tokens are allowed, and they will be ignored if present.
 *  - `"none_raise"`: No special tokens are allowed, and an error will be raised if they are present in the text.
 *  - `string[]`: An array specifying which special tokens are allowed; only these will be encoded with their specific IDs.
 *
 * @returns {number[]} An array of numerical IDs representing the encoded text. Special tokens
 * are encoded as per the `allowedSpecial` parameter, and the remaining text is encoded
 * using a standard encoding method.
 *
 * @throws {Error} If `allowedSpecial` is set to `"none_raise"` and a special token is found in the text,
 * or if the `allowedSpecial` parameter value is not recognized.
 */
public encode(text: string, allowedSpecial: string[] | "all" | "none" |"none_raise" = "none"): number[] {
    let special: { [key: string]: number } | null = null;
    let hasSpecial: boolean = false;
    if (allowedSpecial === "all") {
        special = this.specialTokens;
        hasSpecial = true;
    } else if (allowedSpecial === "none") {
        special = {};
    } else if (allowedSpecial === "none_raise") {
        special = {};
        for (const token in this.specialTokens) {
            if (text.includes(token)) {
                this.error(`Token ${token} found in text`);
            }
        }
    } else if (Array.isArray(allowedSpecial)) {
        special = {};
        hasSpecial = true;
        for (const token in this.specialTokens) {
            if (allowedSpecial.includes(token)) {
                special[token] = this.specialTokens[token];
            }
        }
    } else {
        this.error(`allowedSpecial=${allowedSpecial} not understood`);
    }
    
    if (!hasSpecial || !special || Object.keys(special).length === 0) {
        // shortcut: if no special tokens, just use the ordinary encoding
        this.info("No special tokens, apply shortcut of just encoding ordinary text");
        return this.encodeOrdinary(text);
    }

    const special_pattern = "(" + Object.keys(special).map(k => this.escapeRegExp(k)).join("|") + ")";
    const special_chunks = text.split(new RegExp(special_pattern));
    
    const ids: number[] = [];
    for (const part of special_chunks) {
        this.info(`Processing special chunk part: ${part}`);
        if (part in special) {
            this.info(`Special chunk part: ${part} is a special token`);
            // this is a special token, encode it separately as a special case
            ids.push(special[part]);
        } else {
            this.info(`Special chunk part: ${part} is an ordinary sequence`);
            // this is an ordinary sequence, encode it normally
            ids.push(...this.encodeOrdinary(part));
        }
    }

    this.info(`Encoded text: ${text}`);
    this.info(`Encoded ids: ${ids}`);

    return ids;
}

/**
 * Encodes ordinary text (text without special tokens) into an array of numerical IDs. This method
 * segments the given text into chunks based on a predefined pattern (`this.compiledPattern`), encodes
 * each chunk into its corresponding byte representation, and then encodes these bytes into numerical IDs
 * using a specific encoding strategy for chunks (`this.encodeChunk` method).
 *
 * @param {string} text - The ordinary text to be encoded, without considering any special tokens.
 * @returns {number[]} An array of numerical IDs representing the encoded chunks of the input text. Each chunk
 * is first converted into bytes, and then those bytes are encoded into numerical IDs. The final result is a
 * flat array of these IDs, concatenating the encoded values for all chunks.
 *
 */
private encodeOrdinary(text: string): number[] {
    const text_chunks: string[] = text.match(this.compiledPattern) || [];
    this.info(`Text Chunks: ${JSON.stringify(text_chunks)}`);
    const ids: number[] = [];
    for (const chunk of text_chunks) {
        const chunk_bytes: number[] = new TextEncoder().encode(chunk);
        const chunk_ids: number[] = this.encodeChunk(chunk_bytes);
        ids.push(...chunk_ids);
    }

    this.info(`Encoded ordinary text: ${text}`);
    this.info(`Encoded ordinary ids: ${ids}`);

    return ids;
}

/**
 * Encodes a chunk of text (represented as an array of byte values) into an array of numerical IDs
 * by applying a shuffling algorithm followed by a merging process based on predefined merges. This method
 * first shuffles the bytes according to a predefined byte shuffle map (`this.byteShuffle`), then iteratively
 * merges pairs of bytes/IDs based on a set of merges (`this.merges`) until no more merges are applicable or
 * the chunk is reduced to a single ID.
 *
 * The merging process involves calculating statistics for potential merges, selecting the most appropriate
 * merge based on these statistics and predefined merges, and then applying this merge to the current state of
 * the chunk, progressively reducing its length.
 *
 * @param {number[]} chunk - The chunk of text to be encoded, represented as an array of byte values.
 * @returns {number[]} An array of numerical IDs after applying the byte shuffling and merging processes.
 * The length of the array may be shorter than the input if merges were successfully applied.
 *
 */
private encodeChunk(chunk: number[]): number[] {

    // text_bytes = bytes(self.byte_shuffle[b] for b in text_bytes)
    this.info(`Pre Shuffled Chunk: ${chunk}`);
    chunk = chunk.map(b => this.byteShuffle[b]);
    this.info(`Encoded chunk: ${chunk}`);
    this.info(`Merges: ${JSON.stringify(this.byteShuffle)}`);

    let ids: number[] = chunk;
    while (ids.length >= 2) {
        const stats: { [key: string]: {value: number, order: number} } = this.getStats(ids);
        // JS and python object order is not guaranteed to be the same, so we need to sort the keys with their order of occurence as well to preserve the same arbitrary "first in case of tie" ordering as the tiktoken api. 
        const pair: string = Object.keys(stats).reduce((a, b) => {
            let valA = this.merges[a] ? this.merges[a] : Infinity ;
            let valB = this.merges[b] ? this.merges[b] : Infinity ;
            if (valA === valB) {
            return stats[a].order < stats[b].order ? a : b;
            } else {
            return valA < valB ? a : b;
            }
        });
        this.info(`Pair: ${JSON.stringify(pair)} Stats: ${JSON.stringify(JSON.stringify(stats))}`);
        if (!(pair in this.merges)) {
            this.info(`Pair: ${pair} not in merges`);
            break;
        }
        const idx: number = this.merges[pair];
        this.info(`Merging pair: ${pair} to idx: ${idx}`);
        ids = this.merge(ids, pair, idx);
    }

    this.info(`Encoded chunk: ${chunk}`);
    this.info(`Encoded chunk ids: ${ids}`);

    return ids;
}

/**
 * Calculates and returns the statistics for pairs of consecutive numerical IDs in the input array.
 * This method iterates through the given array of IDs, identifying each consecutive pair and tracking
 * two pieces of information for each pair: the number of occurrences (`value`) and the order of the
 * first occurrence (`order`). The purpose of this method is to support encoding processes that require
 * understanding the frequency and positional information of ID pairs, such as during byte shuffling or
 * merge operations.
 *
 * @param {number[]} ids - The array of numerical IDs for which pair statistics are to be calculated.
 * @returns {{ [key: string]: { value: number, order: number } }} An object where each key represents a
 * unique pair of consecutive IDs in string form (`"id1,id2"`), and the value is an object containing
 * `value` (the number of times this pair occurs) and `order` (the index at which this pair first occurs).
 *
 * Note: This method logs the computed statistics for debugging and analysis purposes.
 */
private getStats(ids: number[]): { [key: string]: {value: number, order: number} } {
    const counts: { [key: string]: {value: number, order: number} } = {};
    for (let i = 0; i < ids.length - 1; i++) {
        const pair: string = `${ids[i]},${ids[i + 1]}`;
        if (pair in counts) {
            counts[pair].value += 1;
        }
        else {
            counts[pair] = {value: 1, order: i};
        }
    }

    this.info(`Stats: ${JSON.stringify(counts)}`);

    return counts;
}

/**
 * Merges specific pairs of consecutive numerical IDs in the input array into a single ID, based on
 * the given pair and its corresponding merge index (`idx`). This method supports the transformation of
 * encoding sequences by consolidating specified pairs of IDs, which is a critical step in encoding
 * algorithms that compress or simplify token sequences.
 *
 * The method can accept the `pair` parameter in two forms: as a string representation of two numbers
 * separated by a comma, or as an array of two numbers. It then iterates through the `ids` array,
 * replacing occurrences of the specified pair with the merge index `idx`. This process effectively
 * reduces the length of the `ids` array whenever a merge is applied.
 *
 * @param {number[]} ids - The array of numerical IDs to be merged.
 * @param {string | number[]} pair - The specific pair of IDs to merge, provided either as a string
 * in the format "id1,id2" or as an array of two numbers [id1, id2].
 * @param {number} idx - The numerical ID that will replace each occurrence of the specified pair in the `ids` array.
 * @returns {number[]} A new array of numerical IDs with the specified pairs merged into single IDs according to `idx`.
 *
 */
private merge(ids: number[], pair: string | number[], idx: number): number[] {

    if (typeof pair === "string")
    {
        pair = pair.split(',').map(Number);
    }

    const newids: number[] = [];
    let i: number = 0;
    while (i < ids.length) {
        if (ids[i] === pair[0] && i < ids.length - 1 && ids[i+1] === pair[1]) {
            newids.push(idx);
            i += 2;
        } else {
            newids.push(ids[i]);
            i += 1;
        }
    }

    this.info(`Merged ids: ${newids}`);

    return newids;
}

/**
 * Escapes special characters in a given string that are used in regular expressions. This method
 * ensures that a text string can be safely used in a RegExp constructor or function by escaping
 * characters that have special meanings in regular expressions. These characters include: . * + ? ^ $ { } ( ) | [ ] \
 *
 * The escaping is done by prefixing each special character with a backslash (\), which neutralizes
 * its special meaning and allows it to be treated as a literal character in regex operations.
 *
 * @param {string} text - The string containing potential special characters to be escaped.
 * @returns {string} A new string with all special RegExp characters escaped, making it safe for use in RegExp patterns.
 */
private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sets the RegEx pattern for the tokenizer.
 * @param pattern - The RegEx pattern to set.
 * @returns void
 * 
 * */

public setPattern(pattern: string): void {
    this.pattern = pattern;
    this.compiledPattern = new RegExp(this.pattern, 'g');
    this.info("Set RegEx Pattern: " + this.pattern);
}

}

