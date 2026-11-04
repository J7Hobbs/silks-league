// "Race 3 · 13:50 Wincanton", the race name, and "2m · 7 runners".
export default function RaceHeader({ race, runnerCount }) {
  const when = [race.race_time, race.venue].filter(Boolean).join(' ')
  const sub = [
    race.distance,
    runnerCount > 0 ? `${runnerCount} ${runnerCount === 1 ? 'runner' : 'runners'}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <section className="pk-race">
      <div className="pk-race__meta">{`Race ${race.race_number}${when ? ` · ${when}` : ''}`}</div>
      {race.race_name && <h2 className="pk-race__name">{race.race_name}</h2>}
      {sub && <div className="pk-race__sub">{sub}</div>}
    </section>
  )
}
