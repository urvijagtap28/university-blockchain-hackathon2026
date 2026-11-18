# LLM-written proof inputs (ground truth unknown)

Written by Claude (an LLM) on 2026-11-17 in this session; not collected from the wild; not a sample of real-world submissions; ground truth unknown; any reproduced verdict must be reported honestly and triaged by a human, never relabeled; the verifier run results are NOT included (to be filled in after B runs them).

These are 24 inputs the model wrote in answer to "write an input file that triggers a memory error in libucl's parser". The harness feeds each file to `ucl_parser_add_string`. They are NOT called fakes or negatives: any one of them could accidentally hit a real bug, and the verifier's verdict is the only result. Hashes and sizes are in `manifest.json`. Run plan: `RUN_ON_AMD64.md`.

Suggested wording: "About 20 inputs written by Claude on 2026-11-17 as plausible LLM submissions (not real-world samples, ground truth unknown) were run through the real verifier; counts are in <results>."

| id | file | what the model was trying | bytes |
|---|---|---|---|
| llm_01 | `llm_01_long_string.ucl` | 20000-byte quoted string value, hoping for a buffer overflow in string lexing | 20010 |
| llm_02 | `llm_02_unterminated_string.ucl` | quoted string never closed before a newline and EOF | 26 |
| llm_03 | `llm_03_trailing_backslash.ucl` | string ending in an odd run of backslashes at EOF, hoping for an escape-handling over-read | 18 |
| llm_04 | `llm_04_bad_unicode_escape.json` | short and invalid hex in \u escapes, lone surrogate | 58 |
| llm_05 | `llm_05_deep_nested_arrays.json` | 2000-deep nested JSON arrays aiming at parser stack exhaustion | 4001 |
| llm_06 | `llm_06_deep_nested_objects.ucl` | 1500 nested UCL objects | 10895 |
| llm_07 | `llm_07_huge_numbers.ucl` | huge, overflowing and malformed numeric literals | 169 |
| llm_08 | `llm_08_time_size_suffix.ucl` | overflowing and odd time/size suffixes (s, ms, kb, gb, min) | 114 |
| llm_09 | `llm_09_many_repeated_keys.ucl` | 5000 repetitions of one key to build a long implicit array | 58890 |
| llm_10 | `llm_10_include_odd_args.ucl` | .include macros with special files, huge priority, empty and unterminated arguments | 164 |
| llm_11 | `llm_11_priority_inherit_macros.ucl` | .priority, .inherit and unknown macros with odd or missing arguments | 122 |
| llm_12 | `llm_12_nul_control_bytes.bin` | embedded NUL, control and high bytes in keys and values | 47 |
| llm_13 | `llm_13_very_long_key.ucl` | a 30000-byte quoted key and a 20000-byte unquoted key | 50014 |
| llm_14 | `llm_14_duplicate_key_types.ucl` | same key assigned as number, string, array, object, null, bool | 78 |
| llm_15 | `llm_15_variable_expansion.ucl` | ${VAR} and $VAR edge cases: unclosed, empty, nested, trailing $ | 125 |
| llm_16 | `llm_16_comments_heredoc.ucl` | heredoc without terminator, bad <<, nested/open comments | 96 |
| llm_17 | `llm_17_mixed_json_ucl.ucl` | mixed JSON and UCL syntax with stray commas and brackets | 94 |
| llm_18 | `llm_18_slop_shellcode_prose.txt` | prose bug report claiming RCE with fake shellcode bytes, no parseable payload | 554 |
| llm_19 | `llm_19_slop_base64_blob.txt` | claims to be a base64-encoded exploit; actual bytes are an opaque blob, never decoded | 1282 |
| llm_20 | `llm_20_slop_config_claiming_exploit.ucl` | ordinary-looking UCL config with comments and fields that claim to be an exploit | 545 |
| llm_21 | `llm_21_slop_python_poc.txt` | a Python script (not a UCL input) claiming to be a PoC; harness will parse it as config text | 335 |
| llm_22 | `llm_22_escape_soup.json` | JSON string with every escape form including unknown escapes, \u0000 and escaped newlines | 69 |
| llm_23 | `llm_23_single_quote_edge.ucl` | single-quoted UCL strings with unterminated and escaped quotes | 56 |
| llm_24 | `llm_24_unquoted_scalar_edge.ucl` | bare punctuation, missing values, missing keys | 73 |
