.PHONY: wasm web-install dev build

wasm:
	@command -v wasm-pack >/dev/null 2>&1 || (echo "wasm-pack not found. Install via: cargo install wasm-pack" && exit 1)
	mkdir -p .tmp
	TMPDIR="$(PWD)/.tmp" CARGO_TARGET_DIR="$(PWD)/.tmp/cargo-target" \
		cd crates/sim-core && wasm-pack build --target web --out-dir ../../apps/web/src/wasm/sim_core --out-name sim_core

web-install:
	cd apps/web && npm install

dev: wasm web-install
	cd apps/web && npm run dev

build: wasm
	cd apps/web && npm run build
