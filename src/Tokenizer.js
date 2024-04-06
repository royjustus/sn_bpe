"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tokenizer = exports.TextDecoder = exports.TextEncoder = void 0;
var glide_1 = require("@servicenow/glide");
var UTF8Polyfill_js_1 = require("./UTF8Polyfill.js");
exports.TextEncoder = UTF8Polyfill_js_1.TextEncoderPolyfill;
exports.TextDecoder = UTF8Polyfill_js_1.TextDecoderPolyfill;
/**
 * Represents a tokenizer used for tokenization and text processing.
 */
var Tokenizer = /** @class */ (function () {
    /**
     * Loads a tokenizer from either a string or a GlideRecord.
     * @param tokenizer - The tokenizer to load, either a string or a GlideRecord.
     * @param logLevel - The log level to use. 0 for no logging, 1 for info logging, 2 for warning logging.
     * @param ignoreCache - Whether to force a refresh of the tokenizer.
     * @returns An object containing the loaded tokenizer information, or null if there was an error.
     */
    function Tokenizer(tokenizer, logLevel, ignoreCache) {
        if (logLevel === void 0) { logLevel = 0; }
        if (ignoreCache === void 0) { ignoreCache = false; }
        this.TOKENIZER_TABLE_NAME = 'x_13131_bpe_tokenizer';
        this.TOKENIZER_FILE_NOT_FOUND = 'No attachment found for the given tokenizer ID';
        this.TOKENIZER_NOT_FOUND = 'Tokenizer record not found';
        this.TOKINIZER_ID_NOT_VALID = 'Tokenizer ID is not a valid GUID or GlideRecord object';
        this.tokenizerConfigRawString = null;
        this.pattern = null;
        this.compiledPattern = null;
        this.merges = null;
        this.vocabulary = null;
        this.byteShuffle = [];
        this.inverseByteShuffle = [];
        this.specialTokens = {};
        this.inverseSpecialTokens = {};
        this.logLevel = 0;
        this.logLevel = logLevel;
        try {
            this.loadTokenizerProperties(tokenizer);
        }
        catch (e) {
            this.error("Error Loading Tokenizer Properties: " + e);
        }
        var cacheAttachment = null;
        try {
            cacheAttachment = this.getTokenizerCachedConfig(tokenizer);
        }
        catch (e) {
            this.error("Error Retrieving Cached Tokenizer: " + e);
        }
        if (ignoreCache || (cacheAttachment == null)) {
            try {
                this.generateTokenizer(tokenizer);
                if (!ignoreCache) {
                    this.saveTokenizerCachedConfig(tokenizer, { merges: this.merges, vocabulary: this.vocabulary, byteShuffle: this.byteShuffle, inverseByteShuffle: this.inverseByteShuffle });
                }
            }
            catch (e) {
                this.error("Error Generating Tokenizer: " + e);
            }
        }
        else {
            try {
                var tokenizerConfigRawStream = this.extractFileStream(cacheAttachment);
                this.tokenizerConfigRawString = this.streamToString(tokenizerConfigRawStream);
            }
            catch (e) {
                this.error("Error Loading Cached Tokenizer: " + e);
            }
            try {
                this.info("Retrieved Cached Tokenizer: " + cacheAttachment.getLink(true));
                var tokenizerConfig = JSON.parse(this.tokenizerConfigRawString);
                this.merges = tokenizerConfig.merges;
                this.vocabulary = tokenizerConfig.vocabulary;
                this.byteShuffle = tokenizerConfig.byteShuffle;
                this.inverseByteShuffle = tokenizerConfig.inverseByteShuffle;
            }
            catch (e) {
                this.error("Error Parsing Cached Tokenizer: " + e);
            }
        }
    }
    Tokenizer.prototype.info = function (message) {
        if (this.logLevel > 0) {
            glide_1.gs.info(message);
        }
    };
    Tokenizer.prototype.warning = function (message) {
        if (this.logLevel > 1) {
            glide_1.gs.warn(message);
        }
    };
    Tokenizer.prototype.error = function (message) {
        throw new Error(message);
    };
    /**
     * Generates a tokenizer from either a string or a GlideRecord.
     * @param tokenizer - The tokenizer to generate, either a string or a GlideRecord.
     * @returns An object containing the generated tokenizer information, or null if there was an error.
     */
    Tokenizer.prototype.generateTokenizer = function (tokenizer) {
        var attachment = null;
        ;
        // Retrieve the tokenizer attachment
        try {
            attachment = this.getTokenizerAttachment(tokenizer);
            if (!attachment) {
                return null;
            }
        }
        catch (e) {
            this.error("Error Retrieving Tokenizer Attachment: " + e);
        }
        // Extract the vocabulary and vocabulary array from the stream
        var vocabulary = null;
        var vocabularyArray = null;
        try {
            var stream = null;
            stream = this.extractFileStream(attachment);
            var tokenizer_1 = this.getTokenizerFromStream(stream);
            vocabulary = tokenizer_1.vocabulary;
            vocabularyArray = tokenizer_1.vocabularyArray;
        }
        catch (e) {
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
            for (var i = 0; i < 256; i++) {
                var binaryQuery = Buffer.from([i]);
                var charQuery = binaryQuery.toString('binary');
                var val = vocabulary[charQuery];
                this.byteShuffle[i] = val;
                this.inverseByteShuffle[val] = i;
            }
            this.info("Byte Shuffle: ".concat(JSON.stringify(this.byteShuffle)));
            this.info("Inverse Byte Shuffle: ".concat(JSON.stringify(this.inverseByteShuffle)));
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
    };
    /**
     * Runs a callback on an attachment if the file extension matches the given extension.
     * @param attachment
     * @param extension
     * @param callback
     * @returns
     */
    Tokenizer.prototype.runOnAttatchmentsIfExtensionMatches = function (attachment, extension, callback) {
        if (attachment.getValue('file_name').indexOf(extension) != -1) {
            return callback(attachment);
        }
        else {
            return null;
        }
    };
    /**
     * Retrieves the tokenizer attachment from the database.
     * @param tokenizer - The tokenizer to retrieve the attachment for.
     * @returns The tokenizer attachment, or null if there was an error.
     */
    Tokenizer.prototype.getTokenizerAttachment = function (tokenizer) {
        var tokenizerId = this.validateTokenizer(tokenizer);
        if (!tokenizerId)
            return null;
        var GSA = new glide_1.GlideSysAttachment();
        var attachment = GSA.getAttachments(this.TOKENIZER_TABLE_NAME, tokenizerId);
        var returnAttachment = null;
        while (attachment.next()) {
            this.runOnAttatchmentsIfExtensionMatches(attachment, '.tiktoken.txt', function (attachment) {
                returnAttachment = attachment;
            });
            if (returnAttachment != null)
                return returnAttachment;
        }
        this.error(this.TOKENIZER_FILE_NOT_FOUND);
        return null;
    };
    /**
     * Retrieves the cached tokenizer configuration from the database.
     * @param tokenizer - The tokenizer to retrieve the cached configuration for.
     * @returns The cached tokenizer configuration, or null if there was an error.
     */
    Tokenizer.prototype.getTokenizerCachedConfig = function (tokenizer) {
        var tokenizerId = this.validateTokenizer(tokenizer);
        if (!tokenizerId)
            return null;
        var GSA = new glide_1.GlideSysAttachment();
        var attachment = GSA.getAttachments(this.TOKENIZER_TABLE_NAME, tokenizerId);
        var returnAttachment = null;
        while (attachment.next()) {
            this.runOnAttatchmentsIfExtensionMatches(attachment, '.cache.text', function (attachment) {
                returnAttachment = attachment;
            });
            if (returnAttachment != null)
                return returnAttachment;
        }
        return null;
    };
    /**
     * Extracts the file stream from an attachment.
     * @param attachment - The attachment to extract the file stream from.
     * @returns The file stream, or null if there was an error.
     * */
    Tokenizer.prototype.extractFileStream = function (attachment) {
        if (!attachment)
            return null;
        var GSA = new glide_1.GlideSysAttachment();
        var stream = GSA.getContentStream(attachment.getUniqueValue());
        return stream;
    };
    /**
     *
     * @param tokenizer The tokenizer to load, either a string or a GlideRecord.
     * @returns null
     */
    Tokenizer.prototype.loadTokenizerProperties = function (tokenizer) {
        var tokenizerId = this.validateTokenizer(tokenizer);
        if (!tokenizerId)
            return null;
        var tokenizerRecord = new glide_1.GlideRecord('x_13131_bpe_tokenizer');
        var found = tokenizerRecord.get("sys_id", tokenizerId);
        if (!found) {
            throw this.TOKENIZER_NOT_FOUND + " ID:" + tokenizerId + " not found. ";
        }
        var specialTokensJson = tokenizerRecord.getValue('special_tokens');
        try {
            this.specialTokens = JSON.parse(specialTokensJson);
        }
        catch (e) {
            this.error('Error parsing special tokens JSON: ' + e);
        }
        var pattern = tokenizerRecord.getValue('pattern_string');
        try {
            this.setPattern(pattern);
        }
        catch (e) {
            this.error('Error loading or parsing RegEx pattern "' + pattern + '" from tokenizer record: ' + e);
        }
    };
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
    Tokenizer.prototype.bpe = function (vocabulary, token, maxRank) {
        var parts = Array.from(token);
        while (true) {
            var minIdx = null;
            var minRank = null;
            for (var i = 0; i < parts.length - 1; i++) {
                var pair = parts[i] + parts[i + 1];
                var rank = vocabulary[pair];
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
    };
    /**
     * Recovers the merges from the vocabulary array and vocabulary. Provides both an array guaranteed to be in the right order and a dictionary for quick lookups.
     * @param vocabularyArray Ordered Array of Tokens
     * @param vocabulary  Dictionary mapping tokens to their rank
     * @returns
     */
    Tokenizer.prototype.recoverMerges = function (vocabularyArray, vocabulary) {
        var merges = {};
        for (var i = 0; i < vocabularyArray.length; i++) {
            var token = vocabularyArray[i][0];
            var rank = vocabularyArray[i][1];
            if (token.length === 1) {
                continue; // skip raw bytes
            }
            var pair = this.bpe(vocabulary, token, rank);
            if (pair.length !== 2) {
                this.error('Invalid pair length (' + pair.length + ') on ' + token + ' ' + pair + ' >>' + rank);
            }
            var ix0 = vocabulary[pair[0]];
            var ix1 = vocabulary[pair[1]];
            merges["".concat(ix0, ",").concat(ix1)] = rank;
        }
        return merges;
    };
    /**
     *
     * @param mergeableRanks Mergable Ranks from the tokenizer to use in extracting the byte vocabulary
     * @returns
     */
    Tokenizer.prototype.createShortVocab = function (mergeableRanks) {
        var vocab = {};
        for (var idx = 0; idx < 256; idx++) {
            vocab[idx.toString()] = String.fromCharCode(idx);
        }
        for (var _i = 0, _a = Object.entries(mergeableRanks); _i < _a.length; _i++) {
            var _b = _a[_i], pair = _b[0], idx = _b[1];
            var _c = pair.split(','), p0 = _c[0], p1 = _c[1];
            vocab[idx.toString()] = vocab[p0] + vocab[p1];
        }
        return vocab;
    };
    /**
     * Converts a stream object to a string.
     *
     * @param stream - The stream object to convert.
     * @returns The string representation of the stream.
     */
    Tokenizer.prototype.streamToString = function (stream) {
        var reader = new glide_1.GlideTextReader(stream);
        var result = '';
        var line = reader.readLine();
        while (line !== null) {
            result += line;
            line = reader.readLine();
        }
        return result;
    };
    /**
     * Converts a stream object into a dictionary of tokens and their corresponding values.
     * @param stream - The stream object to convert.
     * @returns An object containing the token vocabulary and the ordered token vocabulary array.
     */
    Tokenizer.prototype.getTokenizerFromStream = function (stream) {
        var reader = new glide_1.GlideTextReader(stream);
        var line = reader.readLine();
        var loadedTokenCount = 0;
        var vocabulary = {};
        var vocabularyArray = [];
        while (line !== null) {
            var _a = line.split(' '), encodedKey = _a[0], value = _a[1];
            var buffer = Buffer.from(encodedKey, 'base64');
            var bufString = buffer.toString('binary');
            var chars = bufString;
            vocabulary[chars] = parseInt(value, 10);
            vocabularyArray.push([chars, parseInt(value, 10)]);
            loadedTokenCount++;
            line = reader.readLine();
        }
        this.info("Loaded Token Count: " + loadedTokenCount);
        this.info("Vocabulary: " + JSON.stringify(vocabulary));
        this.info("Vocabulary Array: " + JSON.stringify(vocabularyArray));
        return { vocabulary: vocabulary, vocabularyArray: vocabularyArray };
    };
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
    Tokenizer.prototype.validateTokenizer = function (tokenizer) {
        var guidRegex = /^[0-9a-f]{32}$/i;
        if (!tokenizer) {
            this.error(this.TOKINIZER_ID_NOT_VALID);
            return null;
        }
        if (typeof tokenizer === 'string' && guidRegex.test(tokenizer)) {
            return tokenizer;
        }
        else if (tokenizer instanceof glide_1.GlideRecord) {
            return tokenizer.getUniqueValue();
        }
        else {
            this.error(this.TOKINIZER_ID_NOT_VALID);
            return null;
        }
    };
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
    Tokenizer.prototype.saveTokenizerCachedConfig = function (tokenizer, tokenizerConfig) {
        var tokenizerId = this.validateTokenizer(tokenizer);
        if (!tokenizerId)
            return;
        var tokenizerRecord = new glide_1.GlideRecord('x_13131_bpe_tokenizer');
        var found = tokenizerRecord.get("sys_id", tokenizerId);
        if (!found) {
            this.error(this.TOKENIZER_NOT_FOUND);
        }
        var GSA = new glide_1.GlideSysAttachment();
        var attachment = GSA.write(tokenizerRecord, tokenizerId + '.cache.text', 'text/plain', JSON.stringify(tokenizerConfig));
        this.info('Saving Cached tokenizer sys_id is: ' + attachment);
    };
    /**NEEDS TO IMPLEMENT:
    def decode(self, ids):
    # we have to un-permute the bytes before we decode
    text_bytes = b"".join(self.vocab[idx] for idx in ids)
    text_bytes = bytes(self.inverse_byte_shuffle[b] for b in text_bytes)
    text = text_bytes.decode("utf-8", errors="replace")
    return text
     */
    Tokenizer.prototype.decode = function (ids) {
        var _this = this;
        var text_bytes = [];
        for (var _i = 0, ids_1 = ids; _i < ids_1.length; _i++) {
            var idx = ids_1[_i];
            var text_chunk = this.vocabulary[idx];
            for (var i = 0; i < text_chunk.length; i++) {
                text_bytes.push(text_chunk.charCodeAt(i));
            }
        }
        text_bytes = text_bytes.map(function (b) { return _this.inverseByteShuffle[b]; });
        var decoded = new exports.TextDecoder().decode(text_bytes);
        return decoded;
    };
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
    Tokenizer.prototype.encode = function (text, allowedSpecial) {
        var _this = this;
        if (allowedSpecial === void 0) { allowedSpecial = "none"; }
        var special = null;
        var hasSpecial = false;
        if (allowedSpecial === "all") {
            special = this.specialTokens;
            hasSpecial = true;
        }
        else if (allowedSpecial === "none") {
            special = {};
        }
        else if (allowedSpecial === "none_raise") {
            special = {};
            for (var token in this.specialTokens) {
                if (text.includes(token)) {
                    this.error("Token ".concat(token, " found in text"));
                }
            }
        }
        else if (Array.isArray(allowedSpecial)) {
            special = {};
            hasSpecial = true;
            for (var token in this.specialTokens) {
                if (allowedSpecial.includes(token)) {
                    special[token] = this.specialTokens[token];
                }
            }
        }
        else {
            this.error("allowedSpecial=".concat(allowedSpecial, " not understood"));
        }
        if (!hasSpecial || !special || Object.keys(special).length === 0) {
            // shortcut: if no special tokens, just use the ordinary encoding
            this.info("No special tokens, apply shortcut of just encoding ordinary text");
            return this.encodeOrdinary(text);
        }
        var special_pattern = "(" + Object.keys(special).map(function (k) { return _this.escapeRegExp(k); }).join("|") + ")";
        var special_chunks = text.split(new RegExp(special_pattern));
        var ids = [];
        for (var _i = 0, special_chunks_1 = special_chunks; _i < special_chunks_1.length; _i++) {
            var part = special_chunks_1[_i];
            this.info("Processing special chunk part: ".concat(part));
            if (part in special) {
                this.info("Special chunk part: ".concat(part, " is a special token"));
                // this is a special token, encode it separately as a special case
                ids.push(special[part]);
            }
            else {
                this.info("Special chunk part: ".concat(part, " is an ordinary sequence"));
                // this is an ordinary sequence, encode it normally
                ids.push.apply(ids, this.encodeOrdinary(part));
            }
        }
        this.info("Encoded text: ".concat(text));
        this.info("Encoded ids: ".concat(ids));
        return ids;
    };
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
    Tokenizer.prototype.encodeOrdinary = function (text) {
        var text_chunks = text.match(this.compiledPattern) || [];
        this.info("Text Chunks: ".concat(JSON.stringify(text_chunks)));
        var ids = [];
        for (var _i = 0, text_chunks_1 = text_chunks; _i < text_chunks_1.length; _i++) {
            var chunk = text_chunks_1[_i];
            var chunk_bytes = new exports.TextEncoder().encode(chunk);
            var chunk_ids = this.encodeChunk(chunk_bytes);
            ids.push.apply(ids, chunk_ids);
        }
        this.info("Encoded ordinary text: ".concat(text));
        this.info("Encoded ordinary ids: ".concat(ids));
        return ids;
    };
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
    Tokenizer.prototype.encodeChunk = function (chunk) {
        var _this = this;
        // text_bytes = bytes(self.byte_shuffle[b] for b in text_bytes)
        this.info("Pre Shuffled Chunk: ".concat(chunk));
        chunk = chunk.map(function (b) { return _this.byteShuffle[b]; });
        this.info("Encoded chunk: ".concat(chunk));
        this.info("Merges: ".concat(JSON.stringify(this.byteShuffle)));
        var ids = chunk;
        var _loop_1 = function () {
            var stats = this_1.getStats(ids);
            // JS and python object order is not guaranteed to be the same, so we need to sort the keys with their order of occurence as well to preserve the same arbitrary "first in case of tie" ordering as the tiktoken api. 
            var pair = Object.keys(stats).reduce(function (a, b) {
                var valA = _this.merges[a] ? _this.merges[a] : Infinity;
                var valB = _this.merges[b] ? _this.merges[b] : Infinity;
                if (valA === valB) {
                    return stats[a].order < stats[b].order ? a : b;
                }
                else {
                    return valA < valB ? a : b;
                }
            });
            this_1.info("Pair: ".concat(JSON.stringify(pair), " Stats: ").concat(JSON.stringify(JSON.stringify(stats))));
            if (!(pair in this_1.merges)) {
                this_1.info("Pair: ".concat(pair, " not in merges"));
                return "break";
            }
            var idx = this_1.merges[pair];
            this_1.info("Merging pair: ".concat(pair, " to idx: ").concat(idx));
            ids = this_1.merge(ids, pair, idx);
        };
        var this_1 = this;
        while (ids.length >= 2) {
            var state_1 = _loop_1();
            if (state_1 === "break")
                break;
        }
        this.info("Encoded chunk: ".concat(chunk));
        this.info("Encoded chunk ids: ".concat(ids));
        return ids;
    };
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
    Tokenizer.prototype.getStats = function (ids) {
        var counts = {};
        for (var i = 0; i < ids.length - 1; i++) {
            var pair = "".concat(ids[i], ",").concat(ids[i + 1]);
            if (pair in counts) {
                counts[pair].value += 1;
            }
            else {
                counts[pair] = { value: 1, order: i };
            }
        }
        this.info("Stats: ".concat(JSON.stringify(counts)));
        return counts;
    };
    /**
     * Merges specific pairs of consecutive numerical IDs in the input array into a single ID, based on
     * the given pair and its corresponding merge index (`idx`). This method supports the transformation of
     * encoding sequences by consolidating specified pairs of IDs.
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
    Tokenizer.prototype.merge = function (ids, pair, idx) {
        if (typeof pair === "string") {
            pair = pair.split(',').map(Number);
        }
        var newids = [];
        var i = 0;
        while (i < ids.length) {
            if (ids[i] === pair[0] && i < ids.length - 1 && ids[i + 1] === pair[1]) {
                newids.push(idx);
                i += 2;
            }
            else {
                newids.push(ids[i]);
                i += 1;
            }
        }
        this.info("Merged ids: ".concat(newids));
        return newids;
    };
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
    Tokenizer.prototype.escapeRegExp = function (text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };
    /**
     * Sets the RegEx pattern for the tokenizer.
     * @param pattern - The RegEx pattern to set.
     * @returns void
     *
     * */
    Tokenizer.prototype.setPattern = function (pattern) {
        this.pattern = pattern;
        this.compiledPattern = new RegExp(this.pattern, 'g');
        this.info("Set RegEx Pattern: " + this.pattern);
    };
    return Tokenizer;
}());
exports.Tokenizer = Tokenizer;
