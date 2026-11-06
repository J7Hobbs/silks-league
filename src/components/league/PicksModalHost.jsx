import PlayerPicksModal from '../PlayerPicksModal.jsx'

// Opens PlayerPicksModal for a tapped player row. `modal` is the row's modal object
// ({ userId, name, pts, rank, festivalId?, festivalName? }) or null.
export default function PicksModalHost({ modal, viewerUserId, onClose }) {
  if (!modal) return null
  return (
    <PlayerPicksModal
      userId={modal.userId}
      viewerUserId={viewerUserId}
      displayName={modal.name}
      seasonPoints={modal.pts}
      seasonRank={modal.rank}
      festivalId={modal.festivalId || null}
      festivalName={modal.festivalName || null}
      onClose={onClose}
    />
  )
}
