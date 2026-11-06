import PlayerPicksModal from '../PlayerPicksModal.jsx'

// Opens PlayerPicksModal for a tapped player row. `modal` is the row's modal object
// ({ userId, name, pts, rank, seasonId?, festivalId? }): the player's total and position in the table that was tapped.
export default function PicksModalHost({ modal, onClose }) {
  if (!modal) return null
  return (
    <PlayerPicksModal
      key={`${modal.userId}|${modal.festivalId || ''}|${modal.seasonId || ''}`}
      userId={modal.userId}
      displayName={modal.name}
      seasonPoints={modal.pts}
      seasonRank={modal.rank}
      seasonId={modal.seasonId || null}
      festivalId={modal.festivalId || null}
      onClose={onClose}
    />
  )
}
