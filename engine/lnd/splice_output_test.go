package btcwallet

import (
	"testing"

	"github.com/btcsuite/btcd/wire"
	"github.com/stretchr/testify/require"
)

func TestSpliceOutputInBlock(t *testing.T) {
	script := []byte{0, 20, 1}
	coinbase := wire.NewMsgTx(2)
	coinbase.AddTxOut(wire.NewTxOut(50_000, script))
	funding := wire.NewMsgTx(2)
	funding.AddTxOut(wire.NewTxOut(12_345, script))
	op := wire.OutPoint{Hash: funding.TxHash()}
	block := &wire.MsgBlock{Transactions: []*wire.MsgTx{coinbase, funding}}
	out, cb, err := spliceOutputInBlock(block, &op, script)
	require.NoError(t, err)
	require.False(t, cb)
	require.EqualValues(t, 12_345, out.Value)

	_, _, err = spliceOutputInBlock(block, &op, []byte{1})
	require.Error(t, err)
	bad := wire.OutPoint{Hash: op.Hash, Index: 1}
	_, _, err = spliceOutputInBlock(block, &bad, script)
	require.ErrorIs(t, err, ErrOutputNotFound)
	unknown := wire.OutPoint{}
	out, _, err = spliceOutputInBlock(block, &unknown, script)
	require.NoError(t, err)
	require.Nil(t, out)
	reward := wire.OutPoint{Hash: coinbase.TxHash()}
	_, cb, err = spliceOutputInBlock(block, &reward, script)
	require.NoError(t, err)
	require.True(t, cb)

	spend := wire.NewMsgTx(2)
	spend.AddTxIn(wire.NewTxIn(&op, nil, nil))
	block.Transactions = append(block.Transactions, spend)
	_, _, err = spliceOutputInBlock(block, &op, script)
	require.ErrorIs(t, err, ErrOutputSpent)
}
