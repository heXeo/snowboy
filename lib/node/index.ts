import * as stream from 'stream';
import * as path from 'path';
import * as fs from 'fs';
import * as binary from 'node-pre-gyp';

const binding_path: string = binary.find(path.resolve(path.join(__dirname, '../../package.json')));
const SnowboyDetectNative: SnowboyDetectNativeInterface = require(binding_path).SnowboyDetect;

enum DetectionResult {
  SILENCE = -2,
  ERROR = -1,
  NOISE = 0
}

interface HotwordModel {
  file: string;
  sensitivity?: string;
  hotwords: string | Array<string>;
}

interface HotwordModelsInterface {
  add(model: HotwordModel);
  lookup(index: number): string;
  numHotwords(): number;
}

interface DetectorOptions {
  resource: string;
  models: HotwordModels;
  audioGain?: number;
}

interface SnowboyDetectInterface {
  reset(): boolean;
  runDetection(buffer: Buffer): number;
  setSensitivity(sensitivity: string): void;
  getSensitivity(): string;
  setAudioGain(gain: number): void;
  updateModel(): void;
  numHotwords(): number;
  sampleRate(): number;
  numChannels(): number;
  bitsPerSample(): number;
}

export class HotwordModels implements HotwordModels {
  private models: Array<HotwordModel> = [];
  private lookupTable: Array<string>;

  add(model: HotwordModel) {
    model.hotwords = [].concat(model.hotwords);

    if (fs.existsSync(model.file) === false) {
      throw new Error(`Model ${model.file} does not exists.`);
    }

    this.models.push(model);
    this.lookupTable = this.generateHotwordsLookupTable();
  }

  get modelString(): string {
    return this.models.map((model) => model.file).join();
  }

  get sensitivityString(): string {
    return this.models.map((model) => model.sensitivity).join();
  }

  lookup(index: number): string {
    if (index < 0 || this.lookupTable.length) {
      throw new Error('Index out of bounds.');
    }
    return this.lookupTable[index];
  }

  numHotwords(): number {
    return this.lookupTable.length;
  }

  private generateHotwordsLookupTable(): Array<string> {
    return this.models.reduce((hotwords, model) => {
      return hotwords.concat(model.hotwords);
    }, new Array<string>());
  }
}

export class SnowboyDetect extends stream.Writable implements SnowboyDetectInterface {
  nativeInstance: SnowboyDetectNativeInterface;
  private models: HotwordModels;

  constructor(options: DetectorOptions) {
    super();

    this.models = options.models;
    this.nativeInstance = new SnowboyDetectNative(options.resource, options.models.modelString);

    if (this.nativeInstance.NumHotwords() !== options.models.numHotwords()) {
      throw new Error('Loaded hotwords count does not match number of hotwords defined.');
    }

    if (options.audioGain) {
      this.nativeInstance.SetAudioGain(options.audioGain);
    }
  }

  reset(): boolean {
    return this.nativeInstance.Reset();
  }

  runDetection(buffer: Buffer): number {
    const index = this.nativeInstance.RunDetection(buffer);
    this.processDetectionResult(index);
    return index;
  }

  setSensitivity(sensitivity: string): void {
    this.nativeInstance.SetSensitivity(sensitivity);
  }

  getSensitivity(): string {
    return this.nativeInstance.GetSensitivity();
  }

  setAudioGain(gain: number): void {
    this.nativeInstance.SetAudioGain(gain);
  }

  updateModel(): void {
    this.nativeInstance.UpdateModel();
  }

  numHotwords(): number {
    return this.nativeInstance.NumHotwords();
  }

  sampleRate(): number {
    return this.nativeInstance.SampleRate();
  }

  numChannels(): number {
    return this.nativeInstance.NumChannels();
  }

  bitsPerSample(): number {
    return this.nativeInstance.BitsPerSample();
  }

  private processDetectionResult(index: number): void {
    switch (index) {
      case DetectionResult.ERROR:
        this.emit('error');
        break;

      case DetectionResult.SILENCE:
        this.emit('silence');
        break;

      case DetectionResult.NOISE:
        this.emit('noise');
        break;

      default:
        const hotword = this.models.lookup(index);
        this.emit('hotword', hotword);
        break;
    }
  }
}
