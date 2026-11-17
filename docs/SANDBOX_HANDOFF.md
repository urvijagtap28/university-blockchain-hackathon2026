# Sandbox handoff (Person B to Person A)

All values below were read from the repo and from Docker on 2026-11-16 (Windows 11 host, Docker Desktop). None are from memory. The machine-readable source of truth is `verifier/cases.json`. The interface contract is in `docs/INTERFACES.md`.

## Host and Docker
- Docker client 29.9.3 (windows/amd64), server 29.9.3 (linux/amd64), Docker Desktop, kernel 6.18.58.1-microsoft-standard-WSL2, cgroup v2.
- All 12 images are `linux/amd64`. Results apply only to these images on amd64 (see DECISIONS.md).

## Cases: images (pinned by digest) and libucl commits inside each image
The libucl commit is from `git -C /src/libucl rev-parse HEAD` inside the image. Date = commit date.

| Case | Build | Image (verify.py runs this exact digest) | libucl commit | Commit date |
|---|---|---|---|---|
| 42482847 (default) | vul | `n132/arvo@sha256:76a841ce67b750f5abf59477c391f1701384a5f1f84053f4ac5afb112a199483` | `875c25115a36f59a333de79f88235bdfb537c539` | 2020-04-03 |
| 42482847 | fix | `n132/arvo@sha256:02a979ebbb0d5dab1455d079a993baebee8119ea210ea75622afd31e60e63d3d` | `45997ade65d18806f52e3a2f5b8ca2c3e3283554` | 2022-01-06 |
| 42482848 | vul | `n132/arvo@sha256:bc75b21c84cd03a4b867c951e283abc6f6849401532b3642c6012d917ffbaa41` | `875c25115a36f59a333de79f88235bdfb537c539` | 2020-04-03 |
| 42482848 | fix | `n132/arvo@sha256:c2169c93c34b7f972e4f325a7a3ae05df6880d0c8962564d5128f142542aeec4` | `45997ade65d18806f52e3a2f5b8ca2c3e3283554` | 2022-01-06 |
| 42486194 | vul | `n132/arvo@sha256:1800ba425bd254ccebde4cc8b2e748406b63d77cf90dbc4f959bbc881bde139a` | `ac5b3700b9bd78c9bc34f2ac26eaec4333427b40` | 2020-07-19 |
| 42486194 | fix | `n132/arvo@sha256:c2066575b7747d53094c18cf2182a1eeea7afbeaa8bf2e5b9cdf5f0ebd24760b` | `45997ade65d18806f52e3a2f5b8ca2c3e3283554` | 2022-01-06 |
| 42490132 | vul | `n132/arvo@sha256:c30ee80e83fb4a10a06b69acb5aca29e4b2415499ad14b2eccae648a786e392b` | `1de4f36407ffdad12628022db8f914468cf5f00d` | 2020-11-02 |
| 42490132 | fix | `n132/arvo@sha256:25b13d6b8782dd67acbfa7527e23a719a2847c325abb81652db4aaa14235f5a1` | `45997ade65d18806f52e3a2f5b8ca2c3e3283554` | 2022-01-06 |
| 42497487 | vul | `n132/arvo@sha256:2d9b57607673d38c1f6a72338eedeca9982130ccaeb80e910b61054a00ae8971` | `a2ea4abad01e0bd86eec20d7ee970ab2544e0413` | 2021-03-14 |
| 42497487 | fix | `n132/arvo@sha256:314ce81bd1d9121e2248dab27edc885fb85cad61dc67059a51d4490f245d2642` | `45997ade65d18806f52e3a2f5b8ca2c3e3283554` | 2022-01-06 |
| 42512369 | vul | `n132/arvo@sha256:ecd56c3bcfb1f1b4dc1ae56c4925d25ed887739bd65326e40be0199b04387e91` | `95df30cf3e35788c08be537a1623499c98415674` | 2021-08-23 |
| 42512369 | fix | `n132/arvo@sha256:1d1b91a469051ea80639cf8e8f098cd5b83ab376a034dcba3541cdb74ac58bae` | `8a0294f9eaa4e70342e562cb92792bbe3df90e70` | 2025-06-04 |

Expected ASan error type for every case: `heap-buffer-overflow`. The confirmed library frame (vul 3/3; fix clean; harmless input clean on both):

| Case | Frame | Fuzz engine in the image |
|---|---|---|
| 42482847 | `ucl_lex_json_string src/ucl_parser.c:1036:8` | libFuzzer |
| 42482848 | `ucl_parse_value src/ucl_parser.c:1811:10` | libFuzzer |
| 42486194 | `ucl_expand_variable src/ucl_parser.c:550:5` | honggfuzz |
| 42490132 | `ucl_strnstr src/ucl_util.c:2183:12` | libFuzzer |
| 42497487 | `ucl_check_variable src/ucl_parser.c:376:6` | libFuzzer |
| 42512369 | `ucl_hash_search src/ucl_hash.c:460:15` | AFL++ driver |

Caveats:
- Fixed images are a later libucl version, not each bug's exact fix commit (five of the six share `45997ad`). The `45997ad` build still has bug 42512369.
- 42482847 and 42482848 vul images are the same libucl commit.

## Harness: what `/out/ucl_add_string_fuzzer` does
Source `/src/libucl/tests/fuzzers/ucl_add_string_fuzzer.c` is identical in all 12 images (sha256 prefix `ec9232480c806b16`):
```c
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
	if(size==0){ return 0; }
	struct ucl_parser *parser;
	parser = ucl_parser_new(0);
	ucl_parser_add_string(parser, (char *)data, size);
	if (ucl_parser_get_error(parser) != NULL) { return 0; }
	ucl_parser_free (parser);
	return 0;
}
```
- **libucl entry point:** `ucl_parser_new(0)`, then **`ucl_parser_add_string(parser, data, size)`**. The bytes are passed with an explicit length and are NOT NUL-terminated.
- **How input is read:** verify.py passes one argument, `/in/input` (the submission, bind-mounted read-only). The fuzzing engine's driver reads the whole file into a heap buffer and calls `LLVMFuzzerTestOneInput(data, size)` once. Observed driver lines: libFuzzer `Running: /in/input`, honggfuzz `Accepting input from '/in/input'`, AFL++ `Reading N bytes from /in/input`. In the 42482847 trace the overflowed buffer was allocated by `operator new` in `fuzzer::RunOneTest`. That is why a 1-byte over-read past the input is caught.
- **Empty input (0 bytes) returns immediately**, so it is always clean.
- The harness leaks the parser when parsing fails. That is one reason `detect_leaks=0` is set (the fix images also ship `/out/ucl_add_string_fuzzer.options` with `detect_leaks=0`).

## Exact `docker run` (from verifier/verify.py `run_once`)
```
docker run --rm --name verify-<16 hex> --pull never
  --network none --read-only --tmpfs /tmp:rw,size=16m
  --user 1000:1000 --cpus 1 --memory 1g --memory-swap 1g
  --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges
  -e ASAN_OPTIONS=<below>
  --mount type=bind,src=<private temp copy of input>,dst=/in/input,readonly
  --entrypoint /out/ucl_add_string_fuzzer <image@sha256:...> /in/input
```
`ASAN_OPTIONS=alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3`

Checked inside a container started with these flags: `uid=1000 gid=1000`; writing to `/src` fails with "Read-only file system"; `/tmp` is writable; network interfaces `lo` only; `CapEff: 0000000000000000`; `NoNewPrivs: 1`; `memory.max 1073741824`; `pids.max 64`; `cpu.max 100000 100000`. No host environment is passed in. The image's own build variables are present; none has a secret-like name (checked all 12 images).

Other limits in verify.py:
- Input over 65536 bytes is rejected before any Docker call.
- Total cap 60 s from start, with 5 s kept back for `docker kill <name>` on timeout.
- `--case` must match `^[0-9]{1,12}$` and be listed in cases.json; otherwise inconclusive before any Docker call.
- An image whose platform is not `linux/amd64` gives inconclusive.

## Timing with the lockdown on (`python -I harness/measure_timing.py 5`, 2026-11-16)
- **Per run** (one locked-down `docker run`): n=120, min 0.51 s, median 0.67 s, max 0.92 s. Crashing runs are slower (0.70-0.92 s) than clean runs (0.51-0.72 s) because of symbolization.
- **Per verdict** (`python verify.py`, default case, n=5 each):
  - `reproduced` (3 vul + 1 fix runs): min 3.65 s, median 3.77 s, max 3.79 s.
  - `not_reproduced` (3 vul runs): min 2.30 s, median 2.40 s, max 2.49 s.
  - Input or argument rejections: 0.1-0.8 s (no Docker).
- Backtest (43 calls): 2.0-3.9 s each. The first verdict after pulling images took 8.5 s (cold cache).
- Worst case is bounded by the 60 s cap, and the server's own 60 s cap also applies.

## Running on a Mac (Colima / arm64) and the self-test (added 2026-11-16)
- Person A's run on an M5 Mac under amd64 emulation: containers were killed with exit 137. verify.py now reports that as `inconclusive` with detail `killed (exit 137: ...)`, so the bond is returned and never forfeited.
- Run `python verifier/verify.py --self-test` first. It prints `{"self_test": "pass"|"fail", "detail": ...}` (no `verdict` key) and exits 1 when the host cannot run the harness. On this Windows amd64 host: `{"self_test": "pass", "detail": "host Windows AMD64: case 42482847 harmless input: vul clean, fix clean; harness runs here"}` in 2.0 s.
- Colima shares only `$HOME`: set `VERIFY_TMPDIR` to an existing directory under `$HOME` (for example `export VERIFY_TMPDIR=$HOME/.verify-tmp && mkdir -p "$VERIFY_TMPDIR"`).
- Pull images by digest: `docker pull n132/arvo@sha256:<digest>` for each image in cases.json. There are no tags in cases.json.
- Exit 137 under emulation is expected. We make no claim that the harness works on arm64 or under emulation.

## Not verified
- Behaviour on non-amd64 hosts, or under emulation. Person A saw exit 137 on an M5 Mac; we did not reproduce that here. The exit-137 handling is tested only with a fake Docker that returns 137.
- An input that genuinely hangs libucl (the timeout path was tested with a lowered cap).
- Concurrent verify.py calls (the server must limit to 1-2).
- The four bundled-header cases.
