package com.videodyne.ui

import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.videodyne.AppVm
import com.videodyne.Channel
import com.videodyne.ChannelFilter
import com.videodyne.PhoneAppVm
import com.videodyne.Programme
import com.videodyne.R
import com.videodyne.Themes
import com.videodyne.WbtvTheme
import com.videodyne.themeById
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/*
 * The phone app.
 *
 * The TV client is built around a D-pad: a fixed 540 dp canvas, one focus ring and a key map. None of
 * that helps a thumb. What both apps genuinely share is data and playback, and both live in AppVm —
 * so this file is only layout and gestures: a player pane above a list, a guide you tap through, and
 * a settings page, all reachable from a bar at the bottom.
 *
 * Nothing here reads `vm.onKey`: on a phone the only key is Back, and Back is handled where it means
 * something (leave the full-screen player, close the sheet) — the rest is a tap.
 */

private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
private fun hm(sec: Double) = timeFmt.format(Date((sec * 1000).toLong()))

/** The three panes the bottom bar switches between. */
private enum class Tab(val label: String, val glyph: String) {
    NOW("On now", "▤"),
    GUIDE("Guide", "▦"),
    SETTINGS("Settings", "⚙"),
}

@Composable
fun PhoneRoot(vm: PhoneAppVm) {
    val t = themeById(vm.themeId)
    MaterialTheme(colorScheme = darkColorScheme()) {
        var tab by remember { mutableStateOf(Tab.NOW) }
        var expanded by remember { mutableStateOf(false) }
        var info by remember { mutableStateOf<Programme?>(null) }
        // the view model opens settings by itself when no server has been configured yet
        LaunchedEffect(vm.showSettings) { if (vm.showSettings) tab = Tab.SETTINGS }

        BackHandler(enabled = expanded) { expanded = false }

        Box(Modifier.fillMaxSize().background(t.bg)) {
            Column(Modifier.fillMaxSize()) {
                if (vm.playingId != null) {
                    PlayerPane(
                        vm, t, expanded = expanded,
                        onExpand = { expanded = !expanded },
                        modifier = if (expanded) Modifier.weight(1f) else Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                    )
                }
                if (!expanded) {
                    when (tab) {
                        Tab.NOW -> NowList(vm, t, Modifier.weight(1f)) { i -> tune(vm, i) }
                        Tab.GUIDE -> GuideList(vm, t, Modifier.weight(1f), onTune = { i -> tune(vm, i) }, onInfo = { info = it })
                        Tab.SETTINGS -> PhoneSettings(vm, t, Modifier.weight(1f))
                    }
                    BottomBar(tab, t) { tab = it }
                }
            }
            if (expanded) OsdStrip(vm, t, Modifier.align(Alignment.BottomCenter))
            info?.let { p -> ProgrammeDialog(vm, t, p) { info = null } }
        }
    }
}

/** Tuning always means "watch it here" — never the TV app's fullscreen-the-guide behaviour. */
private fun tune(vm: AppVm, index: Int) {
    val ch = vm.channels.getOrNull(index) ?: return
    vm.selectForDetail(index, vm.currentProgramme(ch))
    vm.tune(index, fullscreen = false)
}

@Composable
private fun BottomBar(tab: Tab, t: WbtvTheme, onTab: (Tab) -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(t.panel).padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (each in Tab.entries) {
            val on = each == tab
            Column(
                Modifier.clip(RoundedCornerShape(10.dp)).clickable { onTab(each) }.padding(horizontal = 20.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(each.glyph, color = if (on) t.sel else t.dim, fontSize = 17.sp)
                Text(
                    each.label, color = if (on) t.sel else t.dim, fontSize = 11.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}

// ------------------------------------------------------------------ the player

@Composable
private fun PlayerPane(vm: AppVm, t: WbtvTheme, expanded: Boolean, onExpand: () -> Unit, modifier: Modifier) {
    var controls by remember { mutableStateOf(true) }
    // the transport fades out while something plays; it stays put while paused or tuning, because
    // that is when the viewer is looking for it
    LaunchedEffect(controls, vm.paused, vm.buffering) {
        if (controls && !vm.paused) { delay(4000); controls = false }
    }
    Box(modifier.background(Color.Black)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                (LayoutInflater.from(ctx).inflate(R.layout.wbtv_player_view, null) as PlayerView).also { it.player = vm.player }
            },
            update = { it.player = vm.player },
        )
        // a tap anywhere shows or hides the transport — no ripple over the picture
        Box(
            Modifier.fillMaxSize().clickable(
                interactionSource = remember { MutableInteractionSource() }, indication = null,
            ) { controls = !controls },
        )
        if (vm.buffering) {
            Text(
                "Tuning…", color = Color.White, fontSize = 14.sp,
                modifier = Modifier.align(Alignment.Center).background(Color(0x99000000), RoundedCornerShape(8.dp))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
        if (controls) {
            val ch = vm.allChannels.firstOrNull { it.id == vm.playingId }
            val behind = vm.behindSec > 20
            Column(
                Modifier.align(Alignment.BottomStart).fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD9000000))))
                    .padding(start = 12.dp, end = 12.dp, top = 24.dp, bottom = 8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${ch?.number ?: ""}", color = t.sel, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    Text(ch?.name ?: "", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.weight(1f))
                    if (vm.paused || behind) {
                        Glyph(if (vm.paused) "⏸ PAUSED" else "⏪ ${behindBy(vm)}", t, on = true) { vm.goLive() }
                    }
                }
                val cur = vm.currentProgramme(ch)
                if (cur != null) {
                    Text(
                        cur.title, color = Color.White, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    val frac = ((vm.nowSec - cur.start) / (cur.end - cur.start).coerceAtLeast(1.0)).coerceIn(0.0, 1.0).toFloat()
                    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).height(3.dp).clip(RoundedCornerShape(50)).background(t.dim.copy(alpha = .4f))) {
                        Box(Modifier.fillMaxWidth(frac).fillMaxSize().background(t.accent))
                    }
                    Text("${hm(cur.start)}–${hm(cur.end)}", color = t.dim, fontSize = 10.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Glyph("⏪ 30", t) { vm.seekBy(-30) }
                    Glyph(if (vm.paused) "▶  Play" else "⏸  Pause", t, on = vm.paused) { vm.togglePause() }
                    Glyph("⏩ 30", t) { vm.seekBy(30) }
                    Spacer(Modifier.weight(1f))
                    Glyph(if (expanded) "⤡" else "⤢", t) { onExpand() }
                }
            }
        }
    }
}

private fun behindBy(vm: AppVm): String {
    val s = vm.behindSec.toInt()
    return "%d:%02d".format(s / 60, s % 60)
}

/** A transport control made of text: the icon sets are not a dependency here, on purpose. */
@Composable
private fun Glyph(text: String, t: WbtvTheme, on: Boolean = false, onClick: () -> Unit) {
    Text(
        text,
        color = if (on) t.sel else Color.White,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { onClick() }
            .background(Color(0x66FFFFFF), RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

@Composable
private fun OsdStrip(vm: AppVm, t: WbtvTheme, modifier: Modifier) {
    val ch = vm.allChannels.firstOrNull { it.id == vm.playingId } ?: return
    val cur = vm.currentProgramme(ch)
    Row(
        modifier.fillMaxWidth().background(Color(0x99000000)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${ch.number ?: ""}", color = t.sel, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(8.dp))
        Text(ch.name, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (cur != null) {
            Spacer(Modifier.width(10.dp))
            Text(cur.title, color = t.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ------------------------------------------------------------------ what is on now

@Composable
private fun ChipRow(vm: AppVm, t: WbtvTheme) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (f in vm.visibleFilters) {
            val on = vm.filter == f
            Text(
                "${f.label}  ${vm.allChannels.count(f.test)}",
                color = if (on) t.selTxt else t.dim,
                fontSize = 12.sp,
                fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) t.sel else t.cell)
                    .clickable { vm.applyFilter(f) }.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun NowList(vm: AppVm, t: WbtvTheme, modifier: Modifier, onTune: (Int) -> Unit) {
    if (vm.allChannels.isEmpty()) { EmptyState(vm, t, modifier); return }
    LazyColumn(modifier.fillMaxWidth()) {
        item { ChipRow(vm, t) }
        itemsIndexed(vm.channels, key = { _, c -> c.id }) { i, ch -> ChannelCard(vm, t, ch, i, onTune) }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
private fun ChannelCard(vm: AppVm, t: WbtvTheme, ch: Channel, index: Int, onTune: (Int) -> Unit) {
    val playing = vm.playingId == ch.id
    val cur = vm.currentProgramme(ch)
    val next = vm.nextProgramme(ch)
    Row(
        Modifier.fillMaxWidth().clickable { onTune(index) }
            .background(if (playing) t.cell2 else t.cell).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${ch.number ?: ""}", color = if (playing) t.accent else t.dim, fontSize = 17.sp,
            fontWeight = FontWeight.Bold, modifier = Modifier.width(50.dp),
        )
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ch.name, color = t.txt, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (playing) Text("   ▶  now", color = t.accent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            Text(
                cur?.title ?: "Adverts and announcements", color = t.txt, fontSize = 13.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (cur != null) {
                val frac = ((vm.nowSec - cur.start) / (cur.end - cur.start).coerceAtLeast(1.0)).coerceIn(0.0, 1.0).toFloat()
                val left = kotlin.math.ceil((cur.end - vm.nowSec) / 60).toInt().coerceAtLeast(1)
                Box(
                    Modifier.fillMaxWidth().padding(top = 5.dp).height(3.dp).clip(RoundedCornerShape(50))
                        .background(t.dim.copy(alpha = .35f)),
                ) { Box(Modifier.fillMaxWidth(frac).fillMaxSize().background(t.accent)) }
                Text(
                    "${hm(cur.start)}–${hm(cur.end)}  ·  $left min left",
                    color = t.dim, fontSize = 11.sp, modifier = Modifier.padding(top = 3.dp),
                )
            } else if (next != null) {
                Text("Next ${hm(next.start)}  ${next.title}", color = t.dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (cur != null) {
            AsyncImage(
                model = vm.api.artUrl(cur.item), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.padding(start = 10.dp).size(width = 44.dp, height = 64.dp).clip(RoundedCornerShape(4.dp)),
            )
        }
    }
}

@Composable
private fun EmptyState(vm: AppVm, t: WbtvTheme, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    Column(
        modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            vm.status ?: "No channels yet — add a library in the Videodyne web UI",
            color = t.txt, fontSize = 14.sp,
        )
        Spacer(Modifier.height(14.dp))
        Button(onClick = { scope.launch { vm.refresh(true) } }, colors = ButtonDefaults.buttonColors(containerColor = t.sel)) {
            Text("Try again", color = t.selTxt)
        }
    }
}

// ------------------------------------------------------------------ the guide

@Composable
private fun GuideList(vm: AppVm, t: WbtvTheme, modifier: Modifier, onTune: (Int) -> Unit, onInfo: (Programme) -> Unit) {
    if (vm.allChannels.isEmpty()) { EmptyState(vm, t, modifier); return }
    LazyColumn(modifier.fillMaxWidth()) {
        item { ChipRow(vm, t) }
        itemsIndexed(vm.channels, key = { _, c -> c.id }) { i, ch -> GuideRow(vm, t, ch, i, onTune, onInfo) }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

/**
 * One channel in the guide: tapping the header opens its programmes, tapping a programme tunes it if
 * it is on air and explains itself if it is not. There is no grid: a phone is 6 cm wide and a
 * two-hour timeline does not fit — the list is the guide.
 */
@Composable
private fun GuideRow(vm: AppVm, t: WbtvTheme, ch: Channel, index: Int, onTune: (Int) -> Unit, onInfo: (Programme) -> Unit) {
    var open by remember(ch.id) { mutableStateOf(false) }
    val programmes = vm.programmes[ch.id].orEmpty()
    val playing = vm.playingId == ch.id
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }
                .background(if (playing) t.cell2 else t.panel).padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${ch.number ?: ""}", color = t.accent, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(50.dp))
            Text(
                ch.name, color = t.txt, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            Text(if (open) "▴  ${programmes.size}" else "▾  ${programmes.size}", color = t.dim, fontSize = 12.sp)
        }
        if (open) {
            for (p in programmes.take(14)) {
                val live = p.airsAt(vm.nowSec)
                val past = p.end <= vm.nowSec
                Row(
                    Modifier.fillMaxWidth()
                        .clickable { if (live) onTune(index) else { vm.selectForDetail(index, p); onInfo(p) } }
                        .background(if (live) t.cell2 else t.cell).padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${hm(p.start)}", color = if (live) t.accent else t.dim, fontSize = 12.sp, modifier = Modifier.width(50.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            p.title, color = if (past) t.dim else t.txt, fontSize = 13.sp, maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val sub = if (p.subtitle.isNotBlank()) (if (p.season != null && p.episode != null) "S${p.season}E${p.episode} · " else "") + p.subtitle else ""
                        if (sub.isNotBlank()) Text(sub, color = t.dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (live) Text("ON AIR", color = t.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/** What a programme is: time, year, rating, genres, the plot, who is in it. */
@Composable
private fun ProgrammeDialog(vm: AppVm, t: WbtvTheme, p: Programme, onDismiss: () -> Unit) {
    val d = vm.detail?.takeIf { it.id == p.item }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = t.panel,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close", color = t.accent) } },
        title = { Text(p.title, color = t.txt) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                val meta = listOfNotNull(
                    "${hm(p.start)}–${hm(p.end)}",
                    p.year?.toString(),
                    p.mpaa?.ifBlank { null },
                    (d?.genres ?: p.genres).take(3).joinToString(", ").ifBlank { null },
                ).joinToString("  ·  ")
                Text(meta, color = t.accent, fontSize = 12.sp)
                val plot = d?.plot?.ifBlank { null } ?: p.plot.orEmpty()
                if (plot.isNotBlank()) Text(plot, color = t.txt, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                val cast = (d?.actors ?: emptyList()).take(6).joinToString { it.name }
                if (cast.isNotBlank()) Text("Starring: $cast", color = t.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
        },
    )
}

// ------------------------------------------------------------------ settings

@Composable
private fun PhoneSettings(vm: PhoneAppVm, t: WbtvTheme, modifier: Modifier) {
    val first = vm.server.isBlank()
    var address by remember { mutableStateOf(vm.server.ifBlank { "192.168.1.110:8420" }) }
    var accessKey by remember { mutableStateOf(vm.api.key) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(vm.server) { vm.loadServerSettings() }

    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(if (first) "Welcome to Videodyne" else "Settings", color = t.txt, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(
            if (first) "Point this app at the server that makes your channels — the same one the TV app and the web guide use."
            else "This is the touch app: tap a channel to watch it, tap a programme to read what it is.",
            color = t.dim, fontSize = 12.sp,
        )
        Heading("Connection", t)
        OutlinedTextField(
            value = address, onValueChange = { address = it; error = null }, singleLine = true,
            label = { Text("Server address") }, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = accessKey, onValueChange = { accessKey = it; error = null }, singleLine = true,
            label = { Text("Access key, only if the server has a password") }, modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = Color(0xFFFF8A8A), fontSize = 12.sp) }
        Button(
            onClick = { busy = true; vm.connect(address, accessKey) { e -> busy = false; error = e } },
            colors = ButtonDefaults.buttonColors(containerColor = t.sel),
        ) { Text(if (busy) "Connecting…" else if (first) "Connect" else "Save address", color = t.selTxt) }

        if (!first) {
            Heading("Appearance", t)
            for (row in Themes.chunked(3)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (th in row) Pill(th.label, th.id == t.id, t) { vm.setTheme(th.id) }
                }
            }

            Heading("On the server — every screen and every app", t)
            if (vm.serverSettings == null) {
                Text(vm.settingsNote ?: "Loading the server's settings…", color = t.dim, fontSize = 12.sp)
            } else {
                Toggle("Ad breaks", vm.serverBool("adsEnabled"), t) { vm.setServerSetting("adsEnabled", it) }
                Toggle("\"Coming up next\" announcements", vm.serverBool("promosEnabled"), t) { vm.setServerSetting("promosEnabled", it) }
                Toggle("Automatic rescans", vm.serverBool("autoScan"), t) { vm.setServerSetting("autoScan", it) }
                Toggle("Channel logo", vm.serverBool("channelBug"), t) { vm.setServerSetting("channelBug", it) }
                Toggle("Station idents", vm.serverBool("identsEnabled"), t) { vm.setServerSetting("identsEnabled", it) }
                Toggle("Closedown overnight", vm.serverBool("signOffEnabled"), t) { vm.setServerSetting("signOffEnabled", it) }
                Toggle("Schedule by time of day", vm.serverBool("autoDaypart"), t) { vm.setServerSetting("autoDaypart", it) }
                Toggle("Match ads to the era", vm.serverBool("eraAds"), t) { vm.setServerSetting("eraAds", it) }

                Heading("Pause and rewind", t)
                Text(
                    "How much television the server keeps behind the live edge; pausing and rewinding use it.",
                    color = t.dim, fontSize = 12.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, mins) in listOf("Off" to 0, "5 min" to 5, "10 min" to 10, "20 min" to 20)) {
                        Pill(label, vm.serverInt("pauseBufferMinutes") == mins, t) { vm.setServerSetting("pauseBufferMinutes", mins) }
                    }
                }

                Heading("Stream size", t)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, h) in listOf("720p" to 720, "576p" to 576, "480p" to 480)) {
                        Pill(label, vm.serverInt("streamHeight") == h, t) { vm.setServerSetting("streamHeight", h) }
                    }
                }

                Spacer(Modifier.height(6.dp))
                Button(onClick = { vm.scanNow() }, colors = ButtonDefaults.buttonColors(containerColor = t.cell)) {
                    Text("Scan the library now", color = t.txt)
                }
                vm.settingsNote?.let { Text(it, color = t.accent, fontSize = 12.sp) }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Heading(text: String, t: WbtvTheme) {
    Text(text, color = t.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
}

/** A rounded, thumb-sized choice: themes, buffer sizes, stream heights. */
@Composable
private fun Pill(text: String, on: Boolean, t: WbtvTheme, onClick: () -> Unit) {
    Text(
        text,
        color = if (on) t.selTxt else t.txt,
        fontSize = 12.sp,
        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) t.sel else t.cell)
            .clickable { onClick() }.padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

/** A labelled on/off switch; `null` means the server has not answered yet. */
@Composable
private fun Toggle(label: String, value: Boolean?, t: WbtvTheme, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(value != true) }.background(t.cell, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = t.txt, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(
            when (value) { true -> "ON"; false -> "OFF"; null -> "…" },
            color = if (value == true) t.accent else t.dim, fontSize = 12.sp, fontWeight = FontWeight.Bold,
        )
    }
}

