import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, requestUrl } from 'obsidian';

const VIEW_TYPE_SIDEBAR = "my-dashboard-sidebar-view";

interface DashboardData {
	weather: {
		location: string;
		currentTemp: string;
		todayHigh: string;
		todayLow: string;
		nextRain: string;
	};
	calendar: {
		next48Hours: Array<{
			summary: string;
			start: string;
			end: string;
			calendar: string;
		}>;
		upcomingWeekend: {
			date: string;
			events: Array<{
				summary: string;
				start: string;
				end: string;
				calendar: string;
			}>;
		};
	};
}

interface CachedData {
	data: DashboardData;
	timestamp: number;
}

interface MyPluginSettings {
	apiKey: string;
	cachedData: CachedData | null;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: '',
	cachedData: null
}

const VALUES = [
	"🎧 30 Minutes of Audio Book before engaging in video content (i.e. YouTube). This prioritizes focus over passive consumption",
	"🏃‍♀️ Cardiovascular Fitness: Engage in running/cardio every other day to promote vascular health and help mitigate the risk of dementia",
	"🏋️ Strength and Role Modeling: Lift weights every other day to maintain physical strength and serve as a positive, active role model for Tommy.",
	"Sim Racing: Let's increase our safety rating!",
	"⛳ Golfer's Commitment: As a golfer, ensure a scheduled training session is always on the calendar within the next seven days. Consistency is key to skill acquisition and retention.",
	"😴 Sleep Foundation: Target a minimum of 7 hours of quality sleep nightly. Sleep deprivation significantly reduces willpower and cognitive function, making it harder to uphold other values and goals.",
	"🚫 Sugar and Processed Food Guardrail: Avoid highly-sweetened and ultra-processed foods. Sugar intake leads to CANCER and DISEASE, diets high in ultra-processed foods are strongly associated with increased risks of obesity, inflammation, and chronic diseases.",
	"🍎 Nutrient-Dense Diet: Prioritize eating beans, lean meats, vegetables, fruits, eggs, and nuts. This dietary pattern is rich in fiber, antioxidants, and healthy fats, which directly support vascular health and neuroprotection.",
	"⚡ Act with Purpose: Execute goals and tasks with urgency. However, reserve time for friends and family; remember Memento Mori and recognize that regret often stems from inaction or delay in valuing relationships.",
	"🧠 Be dumb: Aim to be informed, not a know-it-all. Limit consumption of global news/information to a single, focused batch per day. Excessive awareness of global events can lead to anxiety."
];

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private autoRefreshInterval: number | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SIDEBAR,
			(leaf) => new SidebarView(leaf, this)
		);

		this.addCommand({
			id: 'open-sidebar-view',
			name: 'Open Dashboard View',
			callback: () => {
				this.activateView();
			}
		});

		this.addSettingTab(new SettingTab(this.app, this));

		// Set up auto-refresh every 4 hours
		this.autoRefreshInterval = window.setInterval(() => {
			this.fetchDashboardData(true);
		}, 4 * 60 * 60 * 1000); // 4 hours

		this.registerInterval(this.autoRefreshInterval);

		// Fetch data on load if cache is old or doesn't exist
		this.checkAndFetchData();
	}

	async checkAndFetchData() {
		const now = Date.now();
		const fourHours = 4 * 60 * 60 * 1000;
		
		if (!this.settings.cachedData || (now - this.settings.cachedData.timestamp) > fourHours) {
			await this.fetchDashboardData(false);
		}
	}

	async fetchDashboardData(showNotice: boolean = true): Promise<boolean> {
		if (!this.settings.apiKey) {
			new Notice('Please set your API key in plugin settings');
			return false;
		}

		try {
			const response = await requestUrl({
				url: 'https://tnkr4zb127.execute-api.us-east-1.amazonaws.com/default/ApiProxy',
				method: 'GET',
				headers: {
					'api-key': this.settings.apiKey
				}
			});

			if (response.status !== 200) {
				throw new Error(`API request failed: ${response.status}`);
			}

			const data: DashboardData = response.json;
			
			this.settings.cachedData = {
				data: data,
				timestamp: Date.now()
			};
			
			await this.saveSettings();
			
			if (showNotice) {
				new Notice('Dashboard data refreshed');
			}

			// Update the view if it's open
			this.updateOpenViews();
			
			return true;
		} catch (error) {
			console.error('Error fetching dashboard data:', error);
			new Notice(`Failed to fetch dashboard data: ${error.message}`);
			return false;
		}
	}

	updateOpenViews() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
		leaves.forEach(leaf => {
			if (leaf.view instanceof SidebarView) {
				leaf.view.refresh();
			}
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		if (this.autoRefreshInterval) {
			window.clearInterval(this.autoRefreshInterval);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Set your API key for the dashboard.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}

class SidebarView extends ItemView {
	plugin: MyPlugin;
	private refreshInterval: number | null = null;
	private valueRotationInterval: number | null = null;
	private currentValueIndex: number = 0;

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentValueIndex = Math.floor(Math.random() * VALUES.length);
	}

	getViewType() {
		return VIEW_TYPE_SIDEBAR;
	}

	getDisplayText() {
		return "Dashboard";
	}

	async onOpen() {
		// Set up refresh interval for updating the view (for sleep countdown and last sync time)
		this.refreshInterval = window.setInterval(() => {
			this.refresh();
		}, 60 * 1000); // Refresh every minute

		// Set up value rotation every 5 minutes
		this.valueRotationInterval = window.setInterval(() => {
			this.currentValueIndex = Math.floor(Math.random() * VALUES.length);
			this.refresh();
		}, 5 * 60 * 1000);

		this.refresh();
	}

	async onClose() {
		if (this.refreshInterval) {
			window.clearInterval(this.refreshInterval);
		}
		if (this.valueRotationInterval) {
			window.clearInterval(this.valueRotationInterval);
		}
	}

	refresh() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('dashboard-view');

		// Add custom styles
		const style = container.createEl('style');
		style.textContent = `
			.dashboard-view {
				padding: 16px;
				overflow-y: auto;
			}
			.dashboard-section {
				margin-bottom: 24px;
			}
			.dashboard-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 16px;
			}
			.sync-container {
				display: flex;
				flex-direction: column;
				align-items: flex-end;
			}
			.sync-button {
				padding: 4px 8px;
				font-size: 12px;
				cursor: pointer;
				border-radius: 4px;
			}
			.last-sync {
				font-size: 10px;
				color: var(--text-muted);
				margin-top: 4px;
			}
			.weather-box {
				background: var(--background-secondary);
				padding: 12px;
				border-radius: 8px;
				margin-bottom: 12px;
			}
			.weather-box > div {
				margin: 4px 0;
			}
			.calendar-event {
				background: var(--background-secondary);
				padding: 8px;
				border-radius: 4px;
				margin-bottom: 8px;
			}
			.calendar-event-personal {
				border-left: 3px solid var(--interactive-accent);
			}
			.calendar-event-family {
				border-left: 3px solid var(--color-purple);
			}
			.event-time {
				font-size: 11px;
				color: var(--text-muted);
				margin-top: 4px;
			}
			.values-box {
				background: var(--background-secondary-alt);
				padding: 12px;
				border-radius: 8px;
				margin-bottom: 12px;
				border-left: 3px solid var(--color-orange);
				line-height: 1.5;
			}
			.sleep-countdown {
				background: var(--background-secondary-alt);
				padding: 12px;
				border-radius: 8px;
				text-align: center;
				border-left: 3px solid var(--color-purple);
			}
			.sleep-hours {
				font-size: 28px;
				font-weight: bold;
				margin: 8px 0;
			}
			.sleep-warning {
				color: var(--color-red);
				font-weight: bold;
				margin-top: 8px;
			}
		`;

		// Header with sync button
		const header = container.createDiv({ cls: 'dashboard-header' });
		header.createEl('h3', { text: 'Dashboard' });
		
		const syncContainer = header.createDiv({ cls: 'sync-container' });
		const syncButton = syncContainer.createEl('button', {
			text: '🔄 Sync',
			cls: 'sync-button'
		});
		
		syncButton.addEventListener('click', async () => {
			syncButton.disabled = true;
			syncButton.textContent = '⏳ Syncing...';
			await this.plugin.fetchDashboardData(true);
			syncButton.disabled = false;
			syncButton.textContent = '🔄 Sync';
			this.refresh();
		});

		if (this.plugin.settings.cachedData) {
			const lastSync = syncContainer.createDiv({ cls: 'last-sync' });
			const timeSince = this.getTimeSince(this.plugin.settings.cachedData.timestamp);
			lastSync.textContent = `Last synced: ${timeSince}`;
		}

		// Display cached data if available
		if (this.plugin.settings.cachedData) {
			const data = this.plugin.settings.cachedData.data;

					// Sleep Countdown (only after 8 PM)
		const now = new Date();
		const hour = now.getHours();
		
		if (hour >= 20 || hour < 6) { // After 8 PM or before 6 AM
			const sleepSection = container.createDiv({ cls: 'dashboard-section' });
			sleepSection.createEl('h4', { text: '😴 Sleep Countdown' });
			const sleepBox = sleepSection.createDiv({ cls: 'sleep-countdown' });
			
			// Create wake time for 6:15 AM Central Time
			const wakeTime = new Date();
			wakeTime.setHours(6, 15, 0, 0);
			
			// If current time is past 6:15 AM, set wake time to tomorrow
			if (now > wakeTime) {
				wakeTime.setDate(wakeTime.getDate() + 1);
			}
			
			const diff = wakeTime.getTime() - now.getTime();
			const hours = Math.floor(diff / (1000 * 60 * 60));
			const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
			
			sleepBox.createEl('div', { text: 'Hours until wake time (6:15 AM)' });
			sleepBox.createEl('div', { text: `${hours}h ${minutes}m`, cls: 'sleep-hours' });
			
			if (hours < 7) {
				sleepBox.createEl('div', { 
					text: '⚠️ You won\'t get 7+ hours of sleep!',
					cls: 'sleep-warning'
				});
			}
		}

			// Weather Section
			const weatherSection = container.createDiv({ cls: 'dashboard-section' });
			weatherSection.createEl('h4', { text: '🌤️ Weather' });
			const weatherBox = weatherSection.createDiv({ cls: 'weather-box' });
			weatherBox.createEl('div', { text: `🌡️ Current: ${data.weather.currentTemp}` });
			weatherBox.createEl('div', { text: `📈 High: ${data.weather.todayHigh} | 📉 Low: ${data.weather.todayLow}` });
			weatherBox.createEl('div', { text: `🌧️ ${data.weather.nextRain}` });

			// Next 48 Hours Section
			const next48Section = container.createDiv({ cls: 'dashboard-section' });
			next48Section.createEl('h4', { text: '📅 Next 48 Hours' });
			
			if (data.calendar.next48Hours.length === 0) {
				next48Section.createEl('p', { text: 'No events scheduled', cls: 'text-muted' });
			} else {
				data.calendar.next48Hours.forEach(event => {
					const calendarClass = event.calendar === 'deltamaze@gmail.com' 
						? 'calendar-event calendar-event-personal' 
						: 'calendar-event calendar-event-family';
					const eventBox = next48Section.createDiv({ cls: calendarClass });
					eventBox.createEl('div', { text: event.summary });
					const timeText = this.formatEventTime(event.start, event.end);
					eventBox.createDiv({ text: timeText, cls: 'event-time' });
				});
			}

			// Upcoming Weekend Section
			const weekendSection = container.createDiv({ cls: 'dashboard-section' });
			weekendSection.createEl('h4', { text: `🎉 ${data.calendar.upcomingWeekend.date}` });
			
			if (data.calendar.upcomingWeekend.events.length === 0) {
				weekendSection.createEl('p', { text: 'No events scheduled', cls: 'text-muted' });
			} else {
				data.calendar.upcomingWeekend.events.forEach(event => {
					const calendarClass = event.calendar === 'deltamaze@gmail.com' 
						? 'calendar-event calendar-event-personal' 
						: 'calendar-event calendar-event-family';
					const eventBox = weekendSection.createDiv({ cls: calendarClass });
					eventBox.createEl('div', { text: event.summary });
					const timeText = this.formatEventTime(event.start, event.end);
					eventBox.createDiv({ text: timeText, cls: 'event-time' });
				});
			}
		} else {
			container.createEl('p', { text: 'No data available. Click sync to load.' });
		}

		// Values Section
		const valuesSection = container.createDiv({ cls: 'dashboard-section' });
		valuesSection.createEl('h4', { text: '💪 Daily Reminder' });
		const valuesBox = valuesSection.createDiv({ cls: 'values-box' });
		valuesBox.createEl('p', { text: VALUES[this.currentValueIndex] });


	}

	getTimeSince(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / (1000 * 60));
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		
		if (days > 0) {
			return `${days}d ${hours % 24}h ago`;
		} else if (hours > 0) {
			return `${hours}h ${minutes % 60}m ago`;
		} else {
			return `${minutes}m ago`;
		}
	}

	formatEventTime(start: string, end: string): string {
		// Check if it's an all-day event (no time component - just YYYY-MM-DD format)
		if (start.length === 10) {
			const startDate = new Date(start + 'T00:00:00');
			const dateOptions: Intl.DateTimeFormatOptions = {
				weekday: 'short',
				month: 'short',
				day: 'numeric'
			};
			return startDate.toLocaleDateString('en-US', dateOptions) + ' • All day';
		}
		
		const startDate = new Date(start);
		const endDate = new Date(end);
		
		const options: Intl.DateTimeFormatOptions = { 
			hour: 'numeric', 
			minute: '2-digit',
			hour12: true 
		};
		
		const startTime = startDate.toLocaleTimeString('en-US', options);
		const endTime = endDate.toLocaleTimeString('en-US', options);
		
		const dateOptions: Intl.DateTimeFormatOptions = {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		};
		const dateStr = startDate.toLocaleDateString('en-US', dateOptions);
		
		return `${dateStr} • ${startTime} - ${endTime}`;
	}
}