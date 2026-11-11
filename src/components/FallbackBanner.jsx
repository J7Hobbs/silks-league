import banner720 from '../assets/ebor-banner-720.webp'
import banner1200 from '../assets/ebor-banner-1200.webp'
import bannerJpg from '../assets/ebor-banner.jpg'

// The photo used when a festival has no banner of its own. The browser picks the WebP size for the screen (about 100 KB on a
// typical phone); the JPEG is only for browsers that can't show WebP. `display: contents` keeps <picture> out of the layout, so
// the <img> sits exactly where it did before and takes the same classes and style.
export default function FallbackBanner({ className, style }) {
  return (
    <picture style={{ display: 'contents' }}>
      <source type="image/webp" srcSet={`${banner720} 720w, ${banner1200} 1200w`} sizes="(min-width: 560px) 560px, 100vw" />
      <img className={className} src={bannerJpg} alt="" style={style} />
    </picture>
  )
}
