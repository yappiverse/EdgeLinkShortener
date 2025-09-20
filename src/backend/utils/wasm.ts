import { initialize } from "svg2png-wasm";
import wasm from "svg2png-wasm/svg2png_wasm_bg.wasm";

let isWasmInitialized = false;

export async function initializeWasm() {
    if (!isWasmInitialized) {
        await initialize(wasm);
        isWasmInitialized = true;
    }
}
