let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayI8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt16ArrayMemory0 = null;
function getInt16ArrayMemory0() {
    if (cachedInt16ArrayMemory0 === null || cachedInt16ArrayMemory0.byteLength === 0) {
        cachedInt16ArrayMemory0 = new Int16Array(wasm.memory.buffer);
    }
    return cachedInt16ArrayMemory0;
}

let cachedInt8ArrayMemory0 = null;
function getInt8ArrayMemory0() {
    if (cachedInt8ArrayMemory0 === null || cachedInt8ArrayMemory0.byteLength === 0) {
        cachedInt8ArrayMemory0 = new Int8Array(wasm.memory.buffer);
    }
    return cachedInt8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const SimFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sim_free(ptr >>> 0, 1));

export class Sim {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sim_free(ptr, 0);
    }
    /**
     * @returns {object}
     */
    ep_q_stats() {
        const ret = wasm.sim_ep_q_stats(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    meta_field() {
        const ret = wasm.sim_meta_field(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Int8Array}
     */
    op_offsets() {
        const ret = wasm.sim_op_offsets(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    op_r_count() {
        const ret = wasm.sim_op_r_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {any} params
     */
    set_params(params) {
        wasm.sim_set_params(this.__wbg_ptr, params);
    }
    /**
     * @returns {number}
     */
    clock_state() {
        const ret = wasm.sim_clock_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {object}
     */
    diagnostics() {
        const ret = wasm.sim_diagnostics(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    meta_layers() {
        const ret = wasm.sim_meta_layers(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    op_budget_k() {
        const ret = wasm.sim_op_budget_k(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint8Array}
     */
    op_k_tokens() {
        const ret = wasm.sim_op_k_tokens(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    base_s_field() {
        const ret = wasm.sim_base_s_field(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint16Array}
     */
    meta_a_field() {
        const ret = wasm.sim_meta_a_field(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Int16Array}
     */
    meta_n_field() {
        const ret = wasm.sim_meta_n_field(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    meta_w_edges() {
        const ret = wasm.sim_meta_w_edges(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    accept_log_ep() {
        const ret = wasm.sim_accept_log_ep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    op_interfaces() {
        const ret = wasm.sim_meta_layers(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    op_stencil_id() {
        const ret = wasm.sim_op_stencil_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    accept_log_len() {
        const ret = wasm.sim_accept_log_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    accept_log_u32() {
        const ret = wasm.sim_accept_log_u32(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    ep_exact_total() {
        const ret = wasm.sim_ep_exact_total(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Array<any>}
     */
    ep_move_labels() {
        const ret = wasm.sim_ep_move_labels(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    ep_naive_total() {
        const ret = wasm.sim_ep_naive_total(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    meta_edge_count() {
        const ret = wasm.sim_meta_edge_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    accept_log_clear() {
        wasm.sim_accept_log_clear(this.__wbg_ptr);
    }
    /**
     * @returns {object}
     */
    energy_breakdown() {
        const ret = wasm.sim_energy_breakdown(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    ep_exact_by_move() {
        const ret = wasm.sim_ep_exact_by_move(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    ep_naive_by_move() {
        const ret = wasm.sim_ep_naive_by_move(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {any} params
     */
    apply_perturbation(params) {
        wasm.sim_apply_perturbation(this.__wbg_ptr, params);
    }
    /**
     * @returns {number}
     */
    n() {
        const ret = wasm.sim_n(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    accept_log_overflowed() {
        const ret = wasm.sim_accept_log_overflowed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} n
     * @param {number} seed
     */
    constructor(n, seed) {
        const ret = wasm.sim_new(n, seed);
        this.__wbg_ptr = ret >>> 0;
        SimFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} steps
     */
    step(steps) {
        wasm.sim_step(this.__wbg_ptr, steps);
    }
    /**
     * @param {number} threshold
     * @returns {Uint32Array}
     */
    bonds(threshold) {
        const ret = wasm.sim_bonds(this.__wbg_ptr, threshold);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    field() {
        const ret = wasm.sim_field(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {bigint}
     */
    clock_q() {
        const ret = wasm.sim_clock_q(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Int16Array}
     */
    counters() {
        const ret = wasm.sim_counters(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    ep_total() {
        const ret = wasm.sim_ep_naive_total(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint16Array}
     */
    apparatus() {
        const ret = wasm.sim_apparatus(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {bigint}
     */
    clock_bwd() {
        const ret = wasm.sim_clock_bwd(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {bigint}
     */
    clock_fwd() {
        const ret = wasm.sim_clock_fwd(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {Float32Array}
     */
    positions() {
        const ret = wasm.sim_positions(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Sim.prototype[Symbol.dispose] = Sim.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_is_null_dfda7d66506c95b5 = function(arg0) {
        const ret = arg0 === null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_ce774f3490692386 = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_number_get_9619185a74197f95 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_string_get_a2a31e16edf96e42 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_get_af9dab7e9603ea93 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_new_1ba21ce319a06297 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_25f239778d6112b9 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_098150f7f9c5954f = function(arg0, arg1) {
        const ret = new Int8Array(getArrayI8FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_41e2764a343e3cb1 = function(arg0, arg1) {
        const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_4d703bec0a9a4603 = function(arg0, arg1) {
        const ret = new Int16Array(getArrayI16FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_9a48ef80d2a51f94 = function(arg0, arg1) {
        const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_db0691b69e9d3891 = function(arg0, arg1) {
        const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_f9c22b9153b26992 = function(arg0, arg1) {
        const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_fc4260e3a67db282 = function(arg0, arg1) {
        const ret = new Uint16Array(getArrayU16FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_with_length_2cde45ae0640b2ff = function(arg0) {
        const ret = new Int16Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_new_with_length_aa5eaf41d35235e5 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_new_with_length_d7142aa2b68069a8 = function(arg0) {
        const ret = new Uint16Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_push_7d9be8f38fc13975 = function(arg0, arg1) {
        const ret = arg0.push(arg1);
        return ret;
    };
    imports.wbg.__wbg_set_781438a03c0c3c81 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt16ArrayMemory0 = null;
    cachedInt8ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('sim_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
