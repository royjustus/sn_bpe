# SN BPE - A Byte Pair Encoder for ServiceNow

## Overview

This project introduces a Byte Pair Encoding (BPE) tokenizer for use in ServiceNow. BPE is a subword tokenization method that allows for efficient encoding and processing of text data by decomposing words into frequently occurring subwords or characters. This approach is beneficial for NLP tasks where the vocabulary might be vast or cannot be predefined. The CL100k Base Tokenizer implemented is the current (March 2024) GPT-4 tokenizer. 

## Features

- Tokenization using Byte Pair Encoding (BPE) method.
- Support for custom tokenization patterns and special tokens though configuration in ServiceNow.
- Efficient tokenizer load/cache processing within ServiceNow using GlideRecord for data retrieval and storage.
- Polyfill for TextEncoder and TextDecoder, facilitating UTF-8 encoding in ServiceNow without external dependencies.

## Installation

1. Ensure you have access to ServiceNow Studio and the necessary permissions to create and manage applications.
2. Use the guide to the ServiceNow SDK to set up your instance connection to facilitate deployment [ServiceNow SDK links](https://docs.servicenow.com/bundle/washingtondc-api-reference/page/script/sdk/concept/servicenow-sdk.html)
3. Run `npm run upload` to deploy the project to your default instance connection. 

## Usage

### Initializing the Tokenizer

The `Tokenizer` class is used to create tokenizer instances capable of processing text according to the BPE method. 

To initialize a tokenizer:

Create a record in x_13131_bpe_tokenizer with a .tiktoken.txt file attachment. See ./examples for sample data. 
Some examples to get started with can be found [here](https://github.com/dqbd/tiktoken/blob/110eef4f6830f4f31e0f9810c8f9b3ef3175a5b4/tiktoken/registry.json#L8):

Note that ServiceNow's JS engine does not support (?i:... case insensitive regex or \p{L} unicode character classes. As a result the Regex in that registry must be substantially modified in order to run in ServiceNow which is the reason for the very long regex in the demo data. 

```js
const { Tokenizer} = require('./src/Tokenizer.js');
const tokenizer = new Tokenizer('c14ba3f74738021051711288c26d430c'); //
const output = tokenizer.encode(TEXT_TO_TEST, "all");
```

When the tokenizer is first run some pre-processing happens based on the tiktoken file. To reduce latency this processing is cached and re-used as a file on the tokenizer gliderecord. 

### Acknowledgments 
This tokenizer is largely based on Andrej Karpathy's [MiniBPE](https://github.com/karpathy/minbpe) and associated youtube video: [Let's build the GPT Tokenizer](https://www.youtube.com/watch?v=zduSFxRajkE)

The UTF8 Encoder Polyfill is based on [TextEncoderLite](https://github.com/coolaj86/TextEncoderLite_tmp)


