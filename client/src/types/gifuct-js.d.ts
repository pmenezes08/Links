declare module 'gifuct-js' {
  export interface GifFrame {
    delay: number
    dims: {
      width: number
      height: number
      top: number
      left: number
    }
    patch: Uint8ClampedArray
    disposalType: number
    transparentIndex?: number
  }

  export interface ParsedGif {
    raw: {
      header: unknown
      lsd: unknown
      gct?: unknown
      frames: unknown[]
    }
    lsd: {
      width: number
      height: number
    }
    gct?: number[][]
  }

  export function parseGIF(buffer: ArrayBuffer): ParsedGif
  export function decompressFrames(gif: ParsedGif, buildImagePatches: boolean): GifFrame[]
}
