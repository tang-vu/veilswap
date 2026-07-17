import { TOKEN_A, TOKEN_B, type TokenInfo } from "../config/veilswap";

export function TokenSelect({ value, onChange }: { value: TokenInfo; onChange: (token: TokenInfo) => void }) {
  return (
    <div className="segmented" role="group" aria-label="token">
      {[TOKEN_A, TOKEN_B].map((token) => (
        <button
          key={token.address}
          className={`segment ${value.address === token.address ? "active" : ""}`}
          onClick={() => onChange(token)}
          type="button"
        >
          {token.symbol}
        </button>
      ))}
    </div>
  );
}
