import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';

const root = process.cwd();

async function generateFixtureFromExtensionTypeScript() {
    const source = `
        import {
            AlgorithmECDSAP256,
            hashBackendJson,
            publicKeyEnvelopeFromPrivate,
            serializeForBackend,
            signHashEnvelope
        } from './src/core/signature.ts';
        import { attachSettlementAuths, zeroSettlementAuth } from './src/core/settlementAuth.ts';
        import { calculateTXID } from './src/core/txHash.ts';
        import type { Transaction, TxCertificate } from './src/core/blockchain.ts';

        const accountPrivateKeyHex = '0000000000000000000000000000000000000000000000000000000000000001';
        Date.now = () => 1700000000000;

        function signTXCer(txCer: TxCertificate): TxCertificate {
            const signedTxCer = JSON.parse(JSON.stringify(txCer)) as TxCertificate;
            const hash = hashBackendJson({
                ...txCer,
                GuarGroupSignature: { R: null, S: null },
                UserSignature: { R: null, S: null },
                UserSignatureV2: { Algorithm: '', Signature: null },
                SettlementAuth: zeroSettlementAuth()
            });
            signedTxCer.UserSignatureV2 = signHashEnvelope(AlgorithmECDSAP256, hash, accountPrivateKeyHex);
            signedTxCer.SettlementAuth = zeroSettlementAuth();
            return signedTxCer;
        }

        const txCer = signTXCer({
            TXCerID: 'tsfixtxcer000001',
            ToAddress: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            Value: 12.5,
            ToInterest: 0,
            FromGuarGroupID: 'group-source',
            ToGuarGroupID: 'group-target',
            SourcePledgeAddress: 'pledge-source-address',
            ConstructionTime: 1,
            Size: 0,
            TXID: 'source-tx-fixture',
            TxCerPosition: { BlockHeight: 3, Index: 1, InIndex: 0 },
            GuarGroupSignature: { R: null, S: null },
            UserSignature: { R: null, S: null },
            UserSignatureV2: { Algorithm: '', Signature: null },
            SettlementAuth: zeroSettlementAuth()
        });

        const transaction: Transaction = {
            TXID: '',
            Size: 0,
            Version: 1,
            GuarantorGroup: 'group-target',
            TXType: 1,
            Value: 12.5,
            ValueDivision: { 0: 12.5 },
            NewValue: 0,
            NewValueDiv: {},
            InterestAssign: {
                Gas: 0,
                Output: 0,
                BackAssign: {
                    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 1
                }
            },
            UserSignature: { R: null, S: null },
            UserSignatureV2: { Algorithm: '', Signature: null },
            TXInputsNormal: [],
            TXInputsCertificate: [txCer],
            TXOutputs: [{
                ToAddress: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                ToValue: 12.5,
                ToGuarGroupID: 'group-target',
                ToPublicKey: { CurveName: 'P256', X: 0n, Y: 0n },
                ToInterest: 0,
                Type: 0,
                ToPeerID: '',
                IsPayForGas: false,
                IsCrossChain: false,
                IsGuarMake: false,
                SeedAnchor: [],
                SeedChainStep: 0,
                DefaultSpendAlgorithm: AlgorithmECDSAP256
            }],
            Data: []
        };

        attachSettlementAuths(transaction, accountPrivateKeyHex);
        transaction.UserSignatureV2 = signHashEnvelope(
            AlgorithmECDSAP256,
            hashBackendJson({
                ...transaction,
                TXID: '',
                Size: 0,
                NewValue: 0,
                UserSignature: { R: null, S: null },
                UserSignatureV2: { Algorithm: '', Signature: null },
                TXType: 0
            }),
            accountPrivateKeyHex
        );
        transaction.TXID = calculateTXID(transaction);

        globalThis.__settlementFixture = JSON.parse(serializeForBackend({
            accountPublicKey: publicKeyEnvelopeFromPrivate(accountPrivateKeyHex),
            transaction
        }));
    `;

    const result = await esbuild.build({
        stdin: {
            contents: source,
            resolveDir: root,
            sourcefile: 'extension-settlement-auth-fixture.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
    });

    const sandbox = {
        require: createRequire(import.meta.url),
        console,
        Buffer,
        process,
        btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    };
    sandbox.globalThis = sandbox;
    sandbox.global = sandbox;

    vm.runInNewContext(result.outputFiles[0].text, sandbox);
    return JSON.parse(JSON.stringify(sandbox.__settlementFixture));
}

const generated = await generateFixtureFromExtensionTypeScript();
const expectedPath = path.resolve(root, '..', 'TransferAreaInterface', 'tests', 'fixtures', 'tsSettlementAuthFixture.json');
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

assert.deepStrictEqual(generated, expected);
console.log('[check:settlement-fixture] extension SettlementAuth fixture matches frontend/Go fixture');
