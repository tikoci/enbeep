.PHONY: test test-py typecheck decode serve

test: ## Bun unit + archive regression tests
	bun test

test-py: ## Legacy Python analyzer tests (old calibration format)
	.venv/bin/python -m unittest discover -s decode -p 'test_*.py' -q

typecheck: ## Strict tsc over TS sources
	bunx tsc --noEmit

decode: ## Decode a WAV: make decode FILE=samples/x.wav SYM=200
	bun run src/decode.ts --file $(FILE) --sym $(SYM)

serve: ## Live decoder page on :3456
	bun run serve
