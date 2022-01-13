// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import fs from 'fs';
import path from 'path';
import stream from 'stream';
import {promisify} from 'util';
import {JWK} from 'node-jose';
import got from 'got';
import { svgToQRImage } from './image';
import { Command } from 'commander';
import { FileInfo, getFileData } from './file';


const outPath = 'testdata';
const baseExampleUrl = 'https://spec.smarthealth.cards/examples/';
const exampleCount = 4;
const exampleQrChunkCount = [1,1,3,1]; // number of QR chunks per example
const examplePrefix = 'example-';
const exampleSuffixes = [
    '-a-fhirBundle.json',
    '-b-jws-payload-expanded.json',
    '-c-jws-payload-minified.json',
    '-d-jws.txt',
    '-e-file.smart-health-card',
    '-f-qr-code-numeric-value-X.txt',
    '-g-qr-code-X.svg'
];

const pipeline = promisify(stream.pipeline);

async function fetchExamples(outdir: string, force = false): Promise<void> {
    
    const getExamples = exampleSuffixes.map(async (exampleSuffix) => {

        for (let i = 0; i < exampleCount; i++) {

            const exampleNumber = i.toLocaleString('en-US', {
                minimumIntegerDigits: 2,
                useGrouping: false,
            });    
            
            // files to download, either one file or multiple chunks
            const exampleFiles = [];
            const exampleFileBase = examplePrefix + exampleNumber + exampleSuffix;
            if (/^-f.+|^-g.+/g.test(exampleSuffix)) {
                // we might have multiple QR files
                for (let j = 0; j < exampleQrChunkCount[i]; j++) {
                    exampleFiles.push(exampleFileBase.replace('X', j.toString()));
                }
            } else {
                exampleFiles.push(exampleFileBase);
            }

            for (const exampleFile of exampleFiles) {
                const filePath = path.join(outdir, exampleFile);

                if (force || !fs.existsSync(filePath)) {
                    const exampleUrl = baseExampleUrl + exampleFile;
                    console.log('Retrieving ' + exampleUrl);
                    try {
                        await pipeline(
                            got.stream(exampleUrl),
                            fs.createWriteStream(filePath)
                        );
                    } catch (err) {
                        console.log('Error retrieving: ' + exampleUrl, (err as Error).message);
                    }
                }
            }
        }
    });
  
    await Promise.all(getExamples);
}

const issuerPrivateKeyUrl = 'https://raw.githubusercontent.com/smart-on-fhir/health-cards/main/generate-examples/src/config/issuer.jwks.private.json';
const issuerPublicKeyFileName = 'issuer.jwks.public.json';


async function fetchKeys(outdir: string, force = false): Promise<void> {

    const filePath = path.join(outdir, issuerPublicKeyFileName);

    if (!fs.existsSync(filePath)) {
        // download the private key set, save as string
        console.log('Retrieving ' + issuerPrivateKeyUrl);
        const issuerPrivateKeySet  = JSON.stringify(await got(issuerPrivateKeyUrl).json());

        // parse the private key set, export back as public
        const isPrivateKey = false;
        const issuerPublicKeySet = (await JWK.asKeyStore(issuerPrivateKeySet)).toJSON(isPrivateKey);
        fs.writeFileSync(filePath, JSON.stringify(issuerPublicKeySet));
    }
}


// for each .svg file, generate a png, jpg, and bmp QR image
async function generateImagesFromSvg(dir: string, force = false) {

    const svgFiles = fs.readdirSync(dir).filter(f => path.extname(f) === '.svg');
    const svgFileInfo: FileInfo[] = await Promise.all(svgFiles.map(f => getFileData(path.join(dir, f))));

    for(const fi of svgFileInfo) {
        await svgToQRImage(fi);
    }
}

const program = new Command();
program.option('-f, --force', 'forces example retrieval, even if already present');
program.parse(process.argv);
const force = !!program.opts().force;

// We have to wrap these calls in an async function for ES5 support
// Typescript error: Top-level 'await' expressions are only allowed when the 'module' option is set to 'esnext'
void (async () => {
    await fetchExamples(outPath, force);
    await fetchKeys(outPath, force);
    await generateImagesFromSvg(outPath);
})();
