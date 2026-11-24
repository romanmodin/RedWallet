package btcwallet

import (
	"bytes"
	"context"
	"errors"

	"github.com/btcsuite/btcd/btcutil/gcs/builder"
	"github.com/btcsuite/btcd/wire"
	"github.com/btcsuite/btcwallet/chain"
	"github.com/lightninglabs/neutrino"
	"github.com/lightninglabs/neutrino/headerfs"
)

// spliceTip requires verified filter headers through the known block-header tip.
func spliceTip(cs *neutrino.ChainService) (*headerfs.BlockStamp, error) {
	tip, err := cs.BestBlock()
	if err != nil {
		return nil, err
	}
	header, height, err := cs.BlockHeaders.ChainTip()
	if err != nil {
		return nil, err
	}
	if int64(height) != int64(tip.Height) || header.BlockHash() != tip.Hash {
		return nil, errors.New("peer funding filters are still syncing")
	}
	return tip, nil
}

// GetSpliceOutput verifies a peer's input on our own chain. Basic filters
// include the script of both created and spent outputs. Walking backwards
// on the tip's ancestry lets us check for a spend and find the funding tx in
// one pass, including for outputs older than the wallet itself.
func (b *BtcWallet) GetSpliceOutput(ctx context.Context, op *wire.OutPoint,
	script []byte) (*wire.TxOut, uint32, bool, error) {

	backend, ok := b.chain.(*chain.NeutrinoClient)
	if !ok {
		return b.GetUtxoDetails(op)
	}
	if !b.spliceScanMtx.TryLock() {
		return nil, 0, false, errors.New("peer funding verification is busy")
	}
	defer b.spliceScanMtx.Unlock()

	cs, ok := backend.CS.(*neutrino.ChainService)
	if !ok {
		return nil, 0, false, errors.New("Neutrino header store unavailable")
	}
	tip, err := spliceTip(cs)
	if err != nil {
		return nil, 0, false, err
	}
	hash := tip.Hash
	for height := tip.Height; height > 0; height-- {
		if err := ctx.Err(); err != nil {
			return nil, 0, false, err
		}
		header, err := cs.GetBlockHeader(&hash)
		if err != nil {
			return nil, 0, false, err
		}
		if header.BlockHash() != hash {
			return nil, 0, false, errors.New("funding header mismatch")
		}

		opts := []neutrino.QueryOption{neutrino.NumRetries(1)}
		filter, err := cs.GetCFilter(hash, wire.GCSFilterRegular, append(opts,
			neutrino.OptimisticReverseBatch(), neutrino.MaxBatchSize(min(64, int64(height))),
		)...)
		if err != nil {
			return nil, 0, false, err
		}
		if filter == nil {
			return nil, 0, false, errors.New("funding block filter unavailable")
		}
		match, err := filter.Match(builder.DeriveKey(&hash), script)
		if err != nil {
			return nil, 0, false, err
		}
		if match {
			if err := ctx.Err(); err != nil {
				return nil, 0, false, err
			}
			block, err := cs.GetBlock(hash, opts...)
			if err != nil {
				return nil, 0, false, err
			}
			out, coinbase, err := spliceOutputInBlock(block.MsgBlock(), op, script)
			if err != nil {
				return nil, 0, false, err
			}
			if out != nil {
				end, err := spliceTip(cs)
				if err != nil {
					return nil, 0, false, err
				}
				if end.Hash != tip.Hash || end.Height != tip.Height {
					return nil, 0, false, errors.New("chain changed during funding verification")
				}
				if err := ctx.Err(); err != nil {
					return nil, 0, false, err
				}
				return out, uint32(tip.Height-height+1), coinbase, nil
			}
		}
		hash = header.PrevBlock
	}
	return nil, 0, false, ErrOutputNotFound
}

// Later transactions can spend earlier outputs in the same block.
func spliceOutputInBlock(block *wire.MsgBlock, op *wire.OutPoint,
	script []byte) (*wire.TxOut, bool, error) {

	for i := len(block.Transactions) - 1; i >= 0; i-- {
		tx := block.Transactions[i]
		for _, in := range tx.TxIn {
			if in.PreviousOutPoint == *op {
				return nil, false, ErrOutputSpent
			}
		}
		if tx.TxHash() != op.Hash {
			continue
		}
		if uint64(op.Index) >= uint64(len(tx.TxOut)) {
			return nil, false, ErrOutputNotFound
		}
		out := tx.TxOut[op.Index]
		if !bytes.Equal(out.PkScript, script) {
			return nil, false, errors.New("funding output script mismatch")
		}
		return out, i == 0, nil
	}
	return nil, false, nil
}
