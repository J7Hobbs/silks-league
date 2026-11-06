import PlayerPicksModal from '../PlayerPicksModal.jsx'

// Opens PlayerPicksModal for a tapped player row. `modal` is the row's modal object
// ({ userId, name, pts, rank, festivalId? }): the player's total and position in the table that was tapped.
export default function PicksModalHost({ modal, onClose }) {
  if (!modal) return null
  return (
    <PlayerPicksModal
      key={`${modal.userId}|${modal.festivalId || ''}`}
      userId={modal.userId}
      displayName={modal.name}
      seasonPoints={modal.pts}
      seasonRank={modal.rank}
      festivalId={modal.festivalId || null}
      onClose={onClose}
    />
  )
}
